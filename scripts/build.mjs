// Arma la web para publicar. Vercel lo ejecuta en cada cambio (ver vercel.json).
//  1. Lee tienda.config.json (lo define el desarrollador) y data/ajustes.json (lo edita el cliente en /admin)
//     y data/promos.json + data/franjas.json (promos y cinta de embalaje, también desde /admin)
//  2. Junta data/productos/*.json y data/categorias/*.json en data/catalogo.json
//  3. Copia el sitio a dist/ reemplazando los %%MARCADORES%%, escribe los productos dentro
//     del HTML (para Google) y genera canonical, Open Graph, datos estructurados, robots.txt y sitemap.xml
// Uso local: node scripts/build.mjs  →  servir la carpeta dist/
import { readdirSync, readFileSync, writeFileSync, rmSync, mkdirSync, cpSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DATA = join(ROOT, 'data');
const DIST = join(ROOT, 'dist');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

rmSync(DIST, { recursive: true, force: true });
mkdirSync(join(DIST, 'data'), { recursive: true });

// ---------- Fotos livianas ----------
// Las tarjetas y la portada muestran las fotos en tamaño chico: se genera una copia WebP del ancho justo
// en dist/img/_opt/. El nombre lleva un hash del contenido, así el navegador la guarda en caché y una foto
// reemplazada en /admin se ve al tiro. Las originales se mantienen (ficha del producto, Google, redes sociales).
// Si sharp no está instalado, se usan las originales.
let sharp = null;
try { sharp = (await import('sharp')).default; } catch { console.warn('⚠️  sharp no está instalado (npm install): se usan las fotos originales'); }
const OPT = 'img/_opt';
const optimizadas = new Map();
function optimizar(src, ancho) {
  const path = String(src || '').replace(/^\//, '');
  if (!sharp || !/\.(jpe?g|png|webp)$/i.test(path) || !existsSync(join(ROOT, path))) return Promise.resolve(path);
  const key = `${path}@${ancho}`;
  if (!optimizadas.has(key)) {
    optimizadas.set(key, (async () => {
      try {
        const buf = readFileSync(join(ROOT, path));
        const out = `${OPT}/${createHash('sha1').update(buf).digest('hex').slice(0, 12)}-${ancho}.webp`;
        mkdirSync(join(DIST, OPT), { recursive: true });
        await sharp(buf).rotate().resize({ width: ancho, withoutEnlargement: true }).webp({ quality: 75 }).toFile(join(DIST, out));
        return out;
      } catch (e) {
        console.warn(`⚠️  No se pudo optimizar ${path}: ${e.message}`);
        return path;
      }
    })());
  }
  return optimizadas.get(key);
}
const MINI = 640; // ancho de las fotos en las tarjetas del catálogo
const config = readJson(join(ROOT, 'tienda.config.json'));
const readData = (file) => (existsSync(join(DATA, file)) ? readJson(join(DATA, file)) : {});
const ajustes = readData('ajustes.json');
const promosData = readData('promos.json');
const franjasData = readData('franjas.json');

// Manda el dominio propio de site_url; si todavía es un .vercel.app, se usa el dominio de producción de Vercel
const propio = config.site_url && !/\.vercel\.app/.test(config.site_url);
const SITE = (!propio && process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : config.site_url || 'http://localhost:5600').replace(/\/$/, '');

// ---------- 1. Datos de la tienda ----------
const str = (v) => (v === undefined || v === null ? '' : String(v).trim());
const T = {
  nombre: str(config.nombre),
  marca_a: str(config.marca_a) || str(config.nombre),
  marca_b: str(config.marca_b),
  rubro: str(config.rubro),
  schema_tipo: str(config.schema_tipo) || 'Store',
  whatsapp: str(ajustes.whatsapp).replace(/\D/g, ''),
  instagram: str(ajustes.instagram).replace(/^@/, ''),
  tiktok: str(ajustes.tiktok).replace(/^@/, ''),
  email: str(ajustes.email),
  ciudad: str(ajustes.ciudad),
  envios: str(ajustes.envios),
  empresas_envio: (Array.isArray(ajustes.empresas_envio) ? ajustes.empresas_envio : ['Blue Express', 'Starken', 'Correos de Chile']).map(str).filter(Boolean),
  seguidores: str(ajustes.seguidores),
  publicaciones: str(ajustes.publicaciones),
  hero_titulo: str(ajustes.hero_titulo),
  hero_destacado: str(ajustes.hero_destacado),
  hero_bajada: str(ajustes.hero_bajada),
};

// ---------- Promos (hasta 4 «cupones» bajo la portada) ----------
const PROMOS_BASE = [
  { titulo: '1 par', precio: '16900', texto: 'Modelos en oferta, tú eliges' },
  { titulo: '2 pares', precio: '28000', texto: 'Combínalos como quieras' },
  { titulo: 'Todo el álbum', precio: '18900', texto: 'Cualquier modelo del álbum' },
];
const promos = (Array.isArray(promosData.promos) ? promosData.promos : PROMOS_BASE)
  .filter((p) => p && str(p.titulo))
  .slice(0, 4)
  .map((p) => ({ titulo: str(p.titulo), precio: Math.round(Number(String(p.precio).replace(/\D/g, '')) || 0), texto: str(p.texto) }));

// ---------- Cinta de embalaje (frases en movimiento) ----------
const CINTA_BASE = ['Frágil · con amor', 'Envíos a todo Chile', 'Horma normal', 'Eco cuero y gamuza', 'Plataformas de temporada'];
const VELOCIDAD = { lenta: 1.6, normal: 1, rapida: 0.6 };
const cinta = (() => {
  const f = franjasData.cinta || {};
  const frases = (Array.isArray(f.frases) ? f.frases : []).map(str).filter(Boolean);
  const lista = frases.length ? frases : CINTA_BASE;
  // se repite hasta tener ~10 frases por mitad, para que el loop no deje huecos en pantallas anchas
  const vuelta = [];
  while (vuelta.length < 10) vuelta.push(...lista);
  return { items: vuelta, segundos: Math.round(vuelta.length * 4.2 * (VELOCIDAD[f.velocidad] || 1)) };
})();

const faltan = ['nombre', 'whatsapp', 'ciudad'].filter((k) => !T[k]);
if (faltan.length) throw new Error(`Faltan datos obligatorios: ${faltan.join(', ')} (tienda.config.json / data/ajustes.json)`);
if (!/^\d{10,15}$/.test(T.whatsapp) || (T.whatsapp.startsWith('56') && !/^569\d{8}$/.test(T.whatsapp))) {
  throw new Error(`WhatsApp inválido "${T.whatsapp}": usa formato internacional; en Chile son 11 dígitos, ej 56912345678`);
}

// ---------- 2. Catálogo ----------
function readFolder(folder) {
  const dir = join(DATA, folder);
  let files = [];
  try { files = readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return []; }
  const items = [];
  for (const file of files) {
    try {
      items.push({ id: basename(file, '.json'), ...readJson(join(dir, file)) });
    } catch (e) {
      // Un archivo dañado no debe botar todo el catálogo: se omite y se avisa en el log
      console.warn(`⚠️  Se omitió ${folder}/${file}: ${e.message}`);
    }
  }
  return items;
}

const num = (v, def) => (v !== '' && v !== null && Number.isFinite(Number(v)) ? Number(v) : def);
const byOrder = (a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, 'es');

const productos = readFolder('productos')
  .filter((p) => p.visible !== false && typeof p.nombre === 'string' && p.nombre.trim())
  .map((p) => ({
    id: p.id,
    nombre: p.nombre.trim(),
    precio: Math.max(0, Math.round(num(p.precio, 0))),
    foto: typeof p.foto === 'string' && p.foto ? p.foto.replace(/^\//, '') : 'img/logo.jpg',
    fotos: (Array.isArray(p.fotos) ? p.fotos : []).filter((f) => typeof f === 'string' && f).map((f) => f.replace(/^\//, '')),
    // tallas únicas y sin vacíos ("36", "37"…); números del CMS se pasan a texto
    tallas: [...new Set((Array.isArray(p.tallas) ? p.tallas : []).map((t) => str(t)).filter(Boolean))],
    descripcion: typeof p.descripcion === 'string' ? p.descripcion.trim() : '',
    incluye: Array.isArray(p.incluye) ? p.incluye.map((i) => String(i).trim()).filter(Boolean) : [],
    etiqueta: typeof p.etiqueta === 'string' ? p.etiqueta.trim() : '',
    agotado: p.agotado === true,
    orden: num(p.orden, 1000),
  }))
  .sort(byOrder)
  .map(({ orden, ...p }) => p);

// Versiones chicas para las tarjetas y miniaturas (la ficha del producto usa las originales)
await Promise.all(productos.map(async (p) => {
  p.mini = await optimizar(p.foto, MINI);
  p.minis = await Promise.all(p.fotos.map((f) => optimizar(f, MINI)));
}));

const ids = new Set(productos.map((p) => p.id));

const categorias = readFolder('categorias')
  .filter((c) => c.visible !== false && typeof c.nombre === 'string' && c.nombre.trim())
  .map((c) => ({
    id: c.id,
    nombre: c.nombre.trim(),
    orden: num(c.orden, 1000),
    // se descartan productos borrados u ocultos, y repetidos
    productos: [...new Set(Array.isArray(c.productos) ? c.productos : [])].filter((id) => ids.has(id)),
  }))
  .sort(byOrder)
  .map(({ orden, ...c }) => c);

// ---------- Códigos de descuento (data/cupones, editables en /admin) ----------
// Se publican como huella SHA-256 y no como texto: la web puede comprobar un código que le escriben,
// pero nadie puede sacar la lista de códigos mirando el archivo. La sal debe coincidir con CUPON_SAL en app.js.
const CUPON_SAL = 'ambar-shoes:';
const normCodigo = (c) => str(c).toUpperCase().replace(/\s+/g, '');
const huella = (c) => createHash('sha256').update(CUPON_SAL + normCodigo(c)).digest('hex');
const hoy = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Santiago' }); // AAAA-MM-DD
const productosDe = Object.fromEntries(categorias.map((c) => [c.id, c.productos]));
const vistos = new Set();
const cupones = readFolder('cupones')
  .filter((c) => c.activo !== false && normCodigo(c.codigo))
  .map((c) => {
    const tipo = c.tipo === 'monto' ? 'monto' : 'porcentaje';
    const valor = Math.max(0, Math.round(num(c.valor, 0)));
    const vence = /^\d{4}-\d{2}-\d{2}/.test(str(c.vence)) ? str(c.vence).slice(0, 10) : '';
    // sin productos ni categorías elegidos = aplica a toda la tienda
    const cats = Array.isArray(c.categorias) ? c.categorias : [];
    const prods = Array.isArray(c.productos) ? c.productos : [];
    const todos = !cats.length && !prods.length;
    return {
      id: c.id,
      codigo: normCodigo(c.codigo),
      h: huella(c.codigo),
      titulo: str(c.titulo) || normCodigo(c.codigo),
      tipo,
      valor: tipo === 'porcentaje' ? Math.min(100, valor) : valor,
      minimo: Math.max(0, Math.round(num(c.minimo, 0))),
      vence,
      productos: todos ? null : [...new Set([...cats.flatMap((id) => productosDe[id] || []), ...prods])].filter((id) => ids.has(id)),
      aplica: todos ? 'Toda la tienda' : [...categorias.filter((x) => cats.includes(x.id)).map((x) => x.nombre), ...(prods.length ? ['productos seleccionados'] : [])].join(', '),
    };
  })
  .filter((c) => {
    if (!c.valor) return console.warn(`⚠️  Cupón «${c.titulo}» sin valor de descuento: se omitió`), false;
    if (c.vence && c.vence < hoy) return console.warn(`ℹ️  Cupón «${c.titulo}» vencido el ${c.vence}: se omitió`), false;
    if (c.productos && !c.productos.length) return console.warn(`⚠️  Cupón «${c.titulo}» no tiene productos visibles: se omitió`), false;
    if (vistos.has(c.codigo)) return console.warn(`⚠️  Código ${c.codigo} repetido: se usa solo el primero`), false;
    vistos.add(c.codigo);
    return true;
  })
  .map(({ id, codigo, ...c }) => c);

writeFileSync(join(DATA, 'catalogo.json'), JSON.stringify({
  _aviso: 'Archivo generado por scripts/build.mjs. No editar a mano.',
  categorias,
  productos,
  cupones,
}, null, 2) + '\n');
console.log(`✅ catálogo: ${productos.length} productos, ${categorias.length} categorías, ${cupones.length} códigos de descuento activos`);

// ---------- 3. Marcadores %%CLAVE%% ----------
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const clp = (n) => '$' + String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
const abs = (path) => `${SITE}/${String(path).replace(/^\//, '')}`;
const colores = config.colores || {};
const fuentes = config.fuentes || {};
const fuenteParam = (f, pesos) => `family=${encodeURIComponent(f).replace(/%20/g, '+')}:wght@${pesos}`;
const FUENTE_TITULOS = fuentes.titulos || 'Unbounded';
const FUENTE_TEXTO = fuentes.texto || 'Hanken Grotesk';
const FUENTE_ETIQUETA = fuentes.etiqueta || 'Space Mono';

const SEO_TITULO = str(config.seo_titulo) || `${T.nombre} · ${T.rubro}`;
const SEO_DESCRIPCION = str(config.seo_descripcion) || T.hero_bajada;
const precios = productos.map((p) => p.precio).filter((n) => n > 0);

const VARS = {
  NOMBRE: T.nombre, MARCA_A: T.marca_a, MARCA_B: T.marca_b, RUBRO: T.rubro,
  SEO_TITULO, SEO_DESCRIPCION,
  CIUDAD: T.ciudad, ENVIOS: T.envios,
  INSTAGRAM: T.instagram, TIKTOK: T.tiktok, EMAIL: T.email,
  SEGUIDORES: T.seguidores, PUBLICACIONES: T.publicaciones,
  DESDE: precios.length ? clp(Math.min(...precios)) : '',
  NMODELOS: String(productos.length),
  HERO_TITULO: T.hero_titulo, HERO_DESTACADO: T.hero_destacado, HERO_BAJADA: T.hero_bajada,
  FUENTES_URL: `https://fonts.googleapis.com/css2?${fuenteParam(FUENTE_TITULOS, '500;700;900')}&${fuenteParam(FUENTE_TEXTO, '400;500;600;700')}&${fuenteParam(FUENTE_ETIQUETA, '400;700')}&display=swap`,
  FUENTE_TITULOS, FUENTE_TEXTO, FUENTE_ETIQUETA,
  GITHUB_REPO: str(config.github_repo), SITE_URL: `${SITE}/`,
  COLOR_KRAFT: colores.kraft, COLOR_KRAFT_OSCURO: colores.kraft_oscuro, COLOR_KRAFT_CLARO: colores.kraft_claro,
  COLOR_TINTA: colores.tinta, COLOR_PAPEL: colores.papel, COLOR_DORADO: colores.dorado,
  COLOR_PRECIO: colores.precio, COLOR_TINTA_SUAVE: colores.tinta_suave,
  CINTA_SEG: String(cinta.segundos),
  // Solo lo que necesita el navegador (app.js)
  TIENDA_JSON: JSON.stringify({
    nombre: T.nombre, whatsapp: T.whatsapp, empresas_envio: T.empresas_envio,
  }),
};

// Bloques opcionales: <!-- SI:CLAVE --> ... <!-- /SI:CLAVE --> se eliminan si CLAVE está vacía
function render(text, file, escape) {
  let out = text;
  for (let prev; prev !== out;) { // se repite para resolver bloques anidados
    prev = out;
    out = out.replace(/<!-- SI:([A-Z0-9_]+) -->([\s\S]*?)<!-- \/SI:\1 -->/g, (m, key, body) => (str(VARS[key]) ? body : ''));
  }
  const missing = new Set();
  out = out.replace(/%%([A-Z0-9_]+)%%/g, (m, key) => {
    const v = VARS[key];
    if (v === undefined || v === null || (v === '' && key.startsWith('COLOR_'))) { missing.add(key); return m; }
    return escape && key !== 'TIENDA_JSON' ? esc(v) : String(v);
  });
  if (missing.size) throw new Error(`${file}: faltan valores para ${[...missing].join(', ')}`);
  return out;
}

// ---------- 4. HTML escrito por el build ----------
const pad = (n) => String(n).padStart(2, '0');
const priceHtml = (p) => (p.precio > 0 ? `<b>${clp(p.precio)}</b>` : '<b>Consultar</b>');
const rango = (p) => (p.tallas.length > 1 ? `${p.tallas[0]}–${p.tallas[p.tallas.length - 1]}` : p.tallas[0] || 'Única');

// misma tarjeta que card() en app.js (n = posición en el catálogo completo)
const card = (p, i) => `
    <article class="card${p.agotado ? ' is-soldout' : ''}">
      <button class="card__img" type="button" data-view="${esc(p.id)}" aria-label="Ver ${esc(p.nombre)}">
        ${p.agotado ? '<span class="badge badge--soldout">Agotado</span>' : p.etiqueta ? `<span class="badge">${esc(p.etiqueta)}</span>` : ''}
        <span class="sticker${p.precio > 0 ? '' : ' sticker--ask'}">${priceHtml(p)}</span>
        <img src="${esc(p.mini)}" alt="${esc(p.nombre)}" loading="lazy" decoding="async">
        ${p.minis[0] ? `<img class="alt" src="${esc(p.minis[0])}" alt="" loading="lazy" decoding="async">` : ''}
      </button>
      <div class="card__body">
        <p class="card__code"><span>Mod. ${pad(i + 1)}</span><span>Nº ${esc(rango(p))}</span></p>
        <h3>${esc(p.nombre)}</h3>
        ${p.descripcion ? `<p class="card__desc">${esc(p.descripcion)}</p>` : ''}
        ${p.tallas.length ? `<ul class="sizes" aria-label="Tallas disponibles">${p.tallas.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
        <div class="card__foot">
          ${p.agotado
            ? `<a class="btn btn--ghost btn--sm" target="_blank" rel="noopener" href="${esc(`https://api.whatsapp.com/send?phone=${T.whatsapp}&text=${encodeURIComponent(`Hola! ¿Tienen stock de ${p.nombre}?`)}`)}">Consultar stock</a>`
            : `<button class="btn btn--primary btn--sm" type="button" data-view="${esc(p.id)}">${p.tallas.length > 1 ? 'Elegir talla' : 'Agregar'}</button>`}
        </div>
      </div>
    </article>`;

const TILE = `
    <div class="tile"><p class="label">¿No es tu número?</p><strong>Pregúntanos por interno y te avisamos qué modelos quedan en tu talla.</strong><button class="btn btn--primary btn--sm" type="button" data-encargo>Escribir ahora</button></div>`; // igual que TILE en app.js

// Cinta transportadora de la portada: 2 columnas con las fotos de los productos, la segunda en sentido contrario
const heroFotos = await Promise.all(productos.slice(0, 8).map(async (p) => ({ src: await optimizar(p.foto, 560), alt: p.nombre })));
const columna = (fotos) => [...fotos, ...fotos].map((f, i) => `<figure><img src="${esc(f.src)}" alt="${i < fotos.length ? esc(f.alt) : ''}"${i < 2 ? '' : ' loading="lazy"'} decoding="async"></figure>`).join('');
const heroHtml = `<div class="belt__col belt__col--a">${columna(heroFotos.filter((_, i) => i % 2 === 0))}</div>
        <div class="belt__col belt__col--b">${columna(heroFotos.filter((_, i) => i % 2 === 1))}</div>`;

const promosHtml = promos.map((p, i) => `
        <li class="promo" style="--i:${i}">
          <span class="promo__t">${esc(p.titulo)}</span>
          <strong class="promo__p">${p.precio > 0 ? clp(p.precio) : ''}</strong>
          <span class="promo__x">${esc(p.texto)}</span>
        </li>`).join('');

const OG_IMAGE = abs(productos[0] ? productos[0].foto : 'img/logo.jpg');
const sameAs = [
  T.instagram && `https://www.instagram.com/${T.instagram}/`,
  T.tiktok && `https://www.tiktok.com/@${T.tiktok}`,
].filter(Boolean);

const jsonLd = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': T.schema_tipo,
      '@id': `${SITE}/#tienda`,
      name: T.nombre,
      description: SEO_DESCRIPCION,
      url: `${SITE}/`,
      logo: abs('img/logo.jpg'),
      image: [OG_IMAGE, abs('img/logo.jpg')],
      email: T.email || undefined,
      telephone: `+${T.whatsapp}`,
      areaServed: { '@type': 'Country', name: 'Chile' }, // tienda online: envíos a todo Chile
      priceRange: precios.length ? `${clp(Math.min(...precios))} – ${clp(Math.max(...precios))}` : undefined,
      currenciesAccepted: 'CLP',
      sameAs: sameAs.length ? sameAs : undefined,
    },
    {
      '@type': 'ItemList',
      name: 'Catálogo',
      // Google exige precio en los Product: los "Consultar precio" quedan fuera de los datos estructurados
      itemListElement: productos.filter((p) => p.precio > 0).map((p, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        item: {
          '@type': 'Product',
          name: p.nombre,
          image: [p.foto, ...p.fotos].map(abs),
          description: p.descripcion || p.nombre,
          offers: {
            '@type': 'Offer',
            url: `${SITE}/#catalogo`,
            price: p.precio,
            priceCurrency: 'CLP',
            availability: `https://schema.org/${p.agotado ? 'OutOfStock' : 'InStock'}`,
            seller: { '@id': `${SITE}/#tienda` },
            // la tienda no acepta cambios ni devoluciones
            hasMerchantReturnPolicy: {
              '@type': 'MerchantReturnPolicy',
              applicableCountry: 'CL',
              returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted',
            },
          },
        },
      })),
    },
  ],
};

const head = `<link rel="canonical" href="${SITE}/">
  <meta property="og:type" content="website">
  <meta property="og:site_name" content="${esc(T.nombre)}">
  <meta property="og:locale" content="es_CL">
  <meta property="og:url" content="${SITE}/">
  <meta property="og:title" content="${esc(SEO_TITULO)}">
  <meta property="og:description" content="${esc(SEO_DESCRIPCION)}">
  <meta property="og:image" content="${OG_IMAGE}">
  <meta name="twitter:card" content="summary_large_image">${config.google_verificacion
    ? `\n  <meta name="google-site-verification" content="${esc(config.google_verificacion)}">` : ''}
  <script type="application/ld+json">${JSON.stringify(jsonLd).replace(/</g, '\\u003c')}</script>`;

// ---------- 5. dist/ ----------
let html = readFileSync(join(ROOT, 'index.html'), 'utf8');
for (const marker of ['<!-- SEO:HEAD', '<!-- SEO:PRODUCTOS -->', '<!-- HERO:FOTOS -->', '<!-- PROMOS -->', '<!-- CINTA -->']) {
  if (!html.includes(marker)) throw new Error(`Falta el marcador ${marker} en index.html`);
}
html = render(html, 'index.html', true)
  .replace(/<!-- SEO:HEAD[^>]*-->/, head)
  .replace('<!-- SEO:PRODUCTOS -->', productos.map(card).join('') + TILE)
  .replace('<!-- HERO:FOTOS -->', heroHtml)
  .replace('<!-- PROMOS -->', promosHtml)
  // la cinta lleva sus frases 2 veces seguidas: la animación corre la mitad y vuelve a empezar sin salto
  .replaceAll('<!-- CINTA -->', [...cinta.items, ...cinta.items].map((t) => `<span>${esc(t)}</span>`).join(''));

cpSync(join(ROOT, 'img'), join(DIST, 'img'), { recursive: true });
if (existsSync(join(ROOT, 'favicon.ico'))) cpSync(join(ROOT, 'favicon.ico'), join(DIST, 'favicon.ico')); // Google busca el ícono aquí
cpSync(join(ROOT, 'admin'), join(DIST, 'admin'), { recursive: true });
cpSync(join(DATA, 'catalogo.json'), join(DIST, 'data', 'catalogo.json'));
cpSync(join(DATA, 'regiones.json'), join(DIST, 'data', 'regiones.json'));
// styles.css y app.js llevan ?v=hash: se guardan en caché y cada cambio publicado se descarga de nuevo
const css = render(readFileSync(join(ROOT, 'styles.css'), 'utf8'), 'styles.css', false);
const js = render(readFileSync(join(ROOT, 'app.js'), 'utf8'), 'app.js', false);
const version = (text) => createHash('sha1').update(text).digest('hex').slice(0, 10);
html = html
  .replace('href="styles.css"', `href="styles.css?v=${version(css)}"`)
  .replace('src="app.js"', `src="app.js?v=${version(js)}"`);
writeFileSync(join(DIST, 'index.html'), html);
writeFileSync(join(DIST, 'styles.css'), css);
writeFileSync(join(DIST, 'app.js'), js);
writeFileSync(join(DIST, 'admin', 'config.yml'), render(readFileSync(join(ROOT, 'admin', 'config.yml'), 'utf8'), 'admin/config.yml', false));

writeFileSync(join(DIST, 'robots.txt'), `User-agent: *\nAllow: /\nDisallow: /admin/\n\nSitemap: ${SITE}/sitemap.xml\n`);
writeFileSync(join(DIST, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${SITE}/</loc><lastmod>${new Date().toISOString().slice(0, 10)}</lastmod></url>
</urlset>
`);

if (!existsSync(join(ROOT, 'img', 'logo.jpg'))) console.warn('⚠️  Falta img/logo.jpg (logo de la tienda)');
console.log(`✅ sitio listo en dist/ para ${SITE}`);
