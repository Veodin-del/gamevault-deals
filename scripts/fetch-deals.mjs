import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const catalogPath = path.join(root, 'catalog-index.json');
const outPath = path.join(root, 'deals.json');

const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

const NON_GAME_DEAL_REGEX = /\b(soundtrack|original score|ost|artbook|art book|season pass|expansion pass|character pass|fighter pass|deluxe upgrade|upgrade pack|upgrade edition|cosmetic pack|skin pack|starter pack|currency|shark card|vc pack|vbucks|v bucks|fc points|fifa points|demo|trial|beta|prologue|benchmark|wallpapers?|strategy guide|dlc pack|bundle pack|add on|addon|bonus content)\b/i;

function isNonGameDealTitle(rawTitle) {
  return NON_GAME_DEAL_REGEX.test(String(rawTitle || ''));
}

function parseGermanDate(dateStr, fallbackYear) {
  if (dateStr && /^\d{2}\.\d{2}\.\d{4}$/.test(dateStr.trim())) {
    const [d, m, y] = dateStr.trim().split('.').map(Number);
    return new Date(y, m - 1, d, 9, 0, 0);
  }
  return new Date(Number(fallbackYear) || 2026, 10, 15, 9, 0, 0);
}

function isUpcomingGame(g) {
  return parseGermanDate(g.releaseDate, g.year).getTime() > Date.now();
}

function supportsStore(g, storeType) {
  const plats = Array.isArray(g.platforms) && g.platforms.length ? g.platforms : [g.platform];
  if (storeType === 'steam') return plats.includes('PC');
  if (storeType === 'ps') return plats.some(p => ['PS5', 'PS4', 'PS3'].includes(p));
  if (storeType === 'psPlus') return plats.some(p => ['PS5', 'PS4', 'PS3', 'PS2', 'PS1'].includes(p));
  return true;
}

function canonicalizeDealTitle(rawTitle) {
  let s = String(rawTitle || '').toLowerCase();
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/ä/g, 'a').replace(/ö/g, 'o').replace(/ü/g, 'u').replace(/ß/g, 'ss');

  const isOriginal = /\(original\)|\(199\d\)|\(200[0-5]\)/i.test(s);
  const isRemake = /\bremake\b/i.test(s);

  s = s.replace(/\((?:ps4\s*&?\s*ps5|ps5\s*&?\s*ps4|ps5|ps4|pc|xbox|1\.0 vollversion|reboot)\)/gi, ' ');
  s = s.replace(/[™®©:'’\-–—.,!?/()\[\]]+/g, ' ');
  s = s.replace(/\b(ps4\s*&?\s*ps5|ps5\s*&?\s*ps4|ps5|ps4|standard edition|digital deluxe edition|deluxe edition|ultimate edition|complete edition|gold edition|game of the year edition|goty edition|definitive edition|director s cut|special edition|anniversary edition|launch edition|collector s edition|extended edition|enhanced edition|cross gen bundle)\b/gi, ' ');

  // Römische Ziffern NUR als eigenständige Wörter normalisieren (so wird "Vice" NIEMALS zu "6")
  const romanMap = [
    [/\bxvi\b/g, '16'], [/\bxv\b/g, '15'], [/\bxiv\b/g, '14'], [/\bxiii\b/g, '13'],
    [/\bxii\b/g, '12'], [/\bxi\b/g, '11'], [/\bix\b/g, '9'], [/\bviii\b/g, '8'],
    [/\bvii\b/g, '7'], [/\bvi\b/g, '6'], [/\biv\b/g, '4'], [/\biii\b/g, '3'],
    [/\bii\b/g, '2'], [/\bv\b/g, '5'], [/\bx\b/g, '10']
  ];
  for (const [rx, num] of romanMap) s = s.replace(rx, num);

  s = s.replace(/\bgta\s+(\d+)\b/g, 'grand theft auto $1');
  s = s.replace(/\btes\s+(\d+)\b/g, 'the elder scrolls $1');
  s = s.replace(/\bkcd\s+(\d+)\b/g, 'kingdom come deliverance $1');

  s = s.replace(/\s+/g, ' ').trim();
  if (isOriginal && !/\boriginal\b/.test(s)) s += ' original';
  if (isRemake && !/\bremake\b/.test(s)) s += ' remake';
  return s;
}

function getGameCanonicalKeys(g) {
  const keys = new Set();
  const full = String(g.title || '');
  const withoutParens = full.replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  const hasOriginOrYearQual = /\((original|199\d|200\d|201\d|202\d|remake)\)/i.test(full);

  const kFull = canonicalizeDealTitle(full);
  if (kFull) keys.add(kFull);

  if (!hasOriginOrYearQual && withoutParens && withoutParens !== full) {
    const kBase = canonicalizeDealTitle(withoutParens);
    if (kBase) keys.add(kBase);
  }

  for (const pm of full.matchAll(/\(([^)]+)\)/g)) {
    const inner = pm[1].trim();
    if (/^(original|remake|remastered|reboot|19\d\d|20\d\d|1\.0 vollversion|project .+|next-gen)$/i.test(inner)) continue;
    const kInner = canonicalizeDealTitle(inner);
    if (kInner && kInner.length >= 4) keys.add(kInner);
  }
  return keys;
}

const bySteamId = new Map();
const pcByCanonTitle = new Map();
const psByCanonTitle = new Map();
for (const g of catalog) {
  if (isUpcomingGame(g)) continue;
  if (g.steamId && supportsStore(g, 'steam')) {
    bySteamId.set(String(g.steamId), g);
  }
  const keys = getGameCanonicalKeys(g);
  if (supportsStore(g, 'steam')) {
    for (const k of keys) if (!pcByCanonTitle.has(k)) pcByCanonTitle.set(k, g);
  }
  if (supportsStore(g, 'ps')) {
    for (const k of keys) if (!psByCanonTitle.has(k)) psByCanonTitle.set(k, g);
  }
}

// STRIKTES Matching: Nur exakte kanonische Übereinstimmung (kein unsicheres startsWith / Teilstring-Matching!)
function matchCatalogGameByTitle(rawTitle, storeType) {
  if (isNonGameDealTitle(rawTitle)) return null;
  const key = canonicalizeDealTitle(rawTitle);
  if (!key || key.length < 3) return null;
  const targetMap = storeType === 'steam' ? pcByCanonTitle : psByCanonTitle;
  return targetMap.get(key) || null;
}

const result = {
  version: 3,
  schemaVersion: 3,
  updatedAt: new Date().toISOString(),
  region: 'DE',
  currency: 'EUR',
  sources: { steam: false, psStore: false, psPlus: false },
  steamSales: {},
  psSales: {},
  psPlus: {},
  titleIndex: {}
};

function registerTitleIndex(title, field, payload) {
  const key = canonicalizeDealTitle(title);
  if (!key) return;
  if (!result.titleIndex[key]) result.titleIndex[key] = {};
  if (!result.titleIndex[key][field]) result.titleIndex[key][field] = payload;
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// ---------------------------------------------------------------------------
// 1. STEAM STORE DE (Offizielle Euro-Preise für alle erschienenen PC-AppIDs)
// ---------------------------------------------------------------------------
async function fetchSteamDeSales() {
  const uniqueSteamIds = [...bySteamId.keys()];
  const batchSize = 35;
  let foundCount = 0;

  for (let i = 0; i < uniqueSteamIds.length; i += batchSize) {
    const chunk = uniqueSteamIds.slice(i, i + batchSize);
    const url = `https://store.steampowered.com/api/appdetails?appids=${chunk.join(',')}&cc=de&filters=price_overview`;
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (!res.ok) continue;
      const data = await res.json();
      for (const appId of chunk) {
        const entry = data[String(appId)];
        const po = entry && entry.success && entry.data && entry.data.price_overview;
        if (po && Number(po.discount_percent) >= 10) {
          const g = bySteamId.get(String(appId));
          if (!g) continue;
          const payload = {
            title: g.title,
            appId: Number(appId),
            discountPct: Number(po.discount_percent),
            priceEur: Number((po.final / 100).toFixed(2)),
            normalEur: Number((po.initial / 100).toFixed(2)),
            url: `https://store.steampowered.com/app/${appId}/`
          };
          result.steamSales[g.id] = payload;
          registerTitleIndex(g.title, 'steam', payload);
          foundCount++;
        }
      }
    } catch (e) {
      console.warn('Steam Batch Hinweis:', e.message);
    }
    await new Promise(r => setTimeout(r, 350));
  }

  // Ergänzend Top-Deals über CheapShark (Steam StoreID=1) mit striktem AppID- oder exaktem Titel-Match
  try {
    const csRes = await fetch('https://www.cheapshark.com/api/1.0/deals?storeID=1&onSale=1&pageSize=60&sortBy=Metacritic');
    if (csRes.ok) {
      const deals = await csRes.json();
      for (const d of deals) {
        if (!d || isNonGameDealTitle(d.title)) continue;
        const disc = Math.round(parseFloat(d.savings || '0'));
        if (disc < 15) continue;
        const appId = d.steamAppID ? Number(d.steamAppID) : null;
        const g = (appId && bySteamId.get(String(appId))) || matchCatalogGameByTitle(d.title, 'steam');
        if (g && g.steamId && appId && Number(g.steamId) !== appId) continue;

        const payload = {
          title: g ? g.title : d.title,
          appId,
          discountPct: disc,
          priceEur: parseFloat(d.salePrice || '0'),
          normalEur: parseFloat(d.normalPrice || '0'),
          url: appId ? `https://store.steampowered.com/app/${appId}/` : `https://www.cheapshark.com/redirect?dealID=${d.dealID}`
        };
        if (g && !result.steamSales[g.id]) {
          result.steamSales[g.id] = payload;
          foundCount++;
        }
        registerTitleIndex(d.title, 'steam', payload);
      }
    }
  } catch (e) {
    console.warn('CheapShark Hinweis:', e.message);
  }

  result.sources.steam = foundCount > 0;
  console.log(`✓ Verifizierte Steam DE Sales gefunden: ${foundCount}`);
}

// ---------------------------------------------------------------------------
// 2. PLAYSTATION STORE DE SALES (PSPrices DE RSS – strikt gematcht)
// ---------------------------------------------------------------------------
function parseRssItems(xmlText) {
  const items = [];
  const itemMatches = xmlText.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const block of itemMatches) {
    const getTag = (tag) => {
      const m = block.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?<\\/${tag}>`, 'i'));
      return m ? m[1].replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').trim() : '';
    };
    items.push({
      title: getTag('title'),
      link: getTag('link'),
      description: getTag('description')
    });
  }
  return items;
}

async function fetchPsStoreDeSales() {
  const rssUrls = [
    'https://psprices.com/region-de/rss/discounts/ps5',
    'https://psprices.com/region-de/rss/discounts/ps4',
    'https://psprices.com/region-de/rss/index/ps5',
    'https://psprices.com/region-de/rss/index/ps4'
  ];

  let psCount = 0;
  for (const url of rssUrls) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/rss+xml, application/xml, text/xml' } });
      if (!res.ok) continue;
      const xml = await res.text();
      const items = parseRssItems(xml);

      for (const it of items) {
        const fullText = `${it.title} ${it.description}`;
        const discMatch = fullText.match(/-\s*(\d{1,2})\s*%/);
        const priceMatches = [...fullText.matchAll(/(?:€|EUR)\s*(\d+[.,]\d{2})|(\d+[.,]\d{2})\s*(?:€|EUR)/gi)]
          .map(m => parseFloat((m[1] || m[2]).replace(',', '.')))
          .filter(n => isFinite(n) && n > 0);

        const discountPct = discMatch ? parseInt(discMatch[1], 10) : 0;
        if (discountPct < 10 && priceMatches.length < 2) continue;

        const cleanTitle = it.title
          .replace(/\s*\([^)]*%[^)]*\)\s*/g, '')
          .replace(/\s*[-–—]\s*\d+%.*$/g, '')
          .replace(/\s*(€|EUR).*$/gi, '')
          .trim();

        if (isNonGameDealTitle(cleanTitle)) continue;

        const salePrice = priceMatches.length > 0 ? Math.min(...priceMatches) : 0;
        const normalPrice = priceMatches.length > 1 ? Math.max(...priceMatches) : 0;
        const finalDisc = discountPct || (normalPrice > salePrice ? Math.round((1 - salePrice / normalPrice) * 100) : 0);
        if (finalDisc < 10) continue;

        const g = matchCatalogGameByTitle(cleanTitle, 'ps');
        const storeUrl = `https://store.playstation.com/de-de/search/${encodeURIComponent(g ? g.title.replace(/\s*\(.*?\)\s*/g, '').trim() : cleanTitle)}`;
        const payload = {
          title: g ? g.title : cleanTitle,
          discountPct: finalDisc,
          priceEur: salePrice,
          normalEur: normalPrice,
          url: storeUrl
        };

        if (g) {
          result.psSales[g.id] = payload;
          registerTitleIndex(g.title, 'ps', payload);
          psCount++;
        } else {
          registerTitleIndex(cleanTitle, 'ps', payload);
        }
      }
    } catch (e) {
      console.warn('PS Store RSS Hinweis:', url, e.message);
    }
  }

  result.sources.psStore = psCount > 0 || Object.values(result.titleIndex).some(x => x.ps);
  console.log(`✓ Verifizierte PlayStation Store DE Sales zugeordnet: ${psCount}`);
}

// ---------------------------------------------------------------------------
// 3. PLAYSTATION PLUS DE (Offizieller PS Blog DE RSS + Verifizierter Katalog)
// ---------------------------------------------------------------------------
const CURATED_PS_PLUS_DE = {
  'p3_6':    { tier: 'Extra',    note: 'Im PlayStation Plus Extra Spielekatalog enthalten' },
  'p3_18':   { tier: 'Extra',    note: 'Im PlayStation Plus Extra Spielekatalog enthalten' },
  'p3_8':    { tier: 'Extra',    note: 'Im PlayStation Plus Extra Spielekatalog enthalten' },
  'p3_14':   { tier: 'Extra',    note: 'Im PlayStation Plus Extra Spielekatalog enthalten' },
  'p3_19':   { tier: 'Extra',    note: 'Death Stranding Director\'s Cut im PS Plus Extra Katalog' },
  'p3_20':   { tier: 'Extra',    note: 'Im PlayStation Plus Extra Spielekatalog enthalten' },
  'p3_10':   { tier: 'Extra',    note: 'Uncharted: Legacy of Thieves im PS Plus Extra Katalog' },
  'g12':     { tier: 'Extra',    note: 'God of War (2018) im PS Plus Extra Spielekatalog' },
  'g11':     { tier: 'Extra',    note: 'God of War Ragnarök im PS Plus Extra Spielekatalog' },
  'g10':     { tier: 'Extra',    note: 'The Last of Us Part I im PS Plus Extra Spielekatalog' },
  'p3_11':   { tier: 'Extra',    note: 'The Last of Us Part II Remastered im PS Plus Extra Katalog' },
  'p3_1':    { tier: 'Extra',    note: 'Star Wars Jedi: Survivor im PS Plus Extra Spielekatalog' },
  'p6_24':   { tier: 'Extra',    note: 'Marvel\'s Spider-Man im PS Plus Extra Spielekatalog' },
  'e_act26': { tier: 'Extra',    note: 'Marvel\'s Spider-Man: Miles Morales im PS Plus Extra Katalog' },
  'e_act9':  { tier: 'Extra',    note: 'Days Gone im PS Plus Extra Spielekatalog' },
  'e_act43': { tier: 'Extra',    note: 'Control: Ultimate Edition im PS Plus Extra Katalog' },
  'p2_20':   { tier: 'Extra',    note: 'Shadow of the Colossus im PS Plus Extra Spielekatalog' },
  'p2_29':   { tier: 'Classics', note: 'Im PlayStation Plus Premium Klassikerkatalog' },
  'p5_4':    { tier: 'Extra',    note: 'Hollow Knight: Voidheart Edition im PS Plus Extra Katalog' },
  'p5_12':   { tier: 'Extra',    note: 'Dead Cells im PS Plus Extra Spielekatalog' },
  'e_plt11': { tier: 'Extra',    note: 'Dave the Diver im PS Plus Extra Spielekatalog' },
  'e_plt12': { tier: 'Extra',    note: 'DREDGE im PS Plus Extra Spielekatalog' },
  'e_fps2':  { tier: 'Extra',    note: 'DOOM (2016) im PS Plus Extra Spielekatalog' },
  'e_fps3':  { tier: 'Extra',    note: 'DOOM Eternal im PS Plus Extra Spielekatalog' },
  'g17':     { tier: 'Extra',    note: 'Skyrim Special Edition im PS Plus Extra Spielekatalog' },
  'e_rpg28': { tier: 'Extra',    note: 'Fallout 4 im PS Plus Extra Spielekatalog' },
  'e_act18': { tier: 'Extra',    note: 'Assassin\'s Creed Origins im PS Plus Extra Katalog' },
  'e_act19': { tier: 'Extra',    note: 'Assassin\'s Creed Odyssey im PS Plus Extra Katalog' },
  'e_act20': { tier: 'Extra',    note: 'Assassin\'s Creed Valhalla im PS Plus Extra Katalog' },
  'e_hor5':  { tier: 'Extra',    note: 'Dead Space Remake (PS5) im PS Plus / EA Play Angebot' },
  'p3_23':   { tier: 'Extra',    note: 'Silent Hill 2 Remake im PS Plus Extra Katalog' },
  'e_act27': { tier: 'Extra',    note: 'Marvel\'s Guardians of the Galaxy im PS Plus Extra Katalog' },
  'g23':     { tier: 'Extra',    note: 'Anno 1800 Console Edition im PS Plus Extra Spielekatalog' },
  'p1_35':   { tier: 'Extra',    note: 'Cities: Skylines im PS Plus Extra Spielekatalog' }
};

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function fetchPsPlusDeUpdates() {
  for (const [id, info] of Object.entries(CURATED_PS_PLUS_DE)) {
    const g = catalog.find(x => x.id === id);
    if (g && supportsStore(g, 'psPlus') && !isUpcomingGame(g)) {
      const payload = { title: g.title, tier: info.tier, note: info.note };
      result.psPlus[id] = payload;
      registerTitleIndex(g.title, 'psPlus', payload);
    }
  }

  // Aktuelle PS Plus Ankündigungen direkt aus dem offiziellen PlayStation Blog DE mit exakten Wortgrenzen scannen
  try {
    const res = await fetch('https://blog.de.playstation.com/feed/', { headers: { 'User-Agent': UA } });
    if (res.ok) {
      const xml = await res.text();
      const items = parseRssItems(xml).filter(it => /playstation\s*plus|ps\s*plus/i.test(it.title));
      for (const it of items.slice(0, 6)) {
        const tier = /monatliche|essential/i.test(it.title) ? 'Essential' : (/klassiker|premium/i.test(it.title) ? 'Classics' : 'Extra');
        const haystack = ' ' + canonicalizeDealTitle(it.title + ' ' + it.description) + ' ';
        for (const g of catalog) {
          if (isUpcomingGame(g) || !supportsStore(g, 'psPlus')) continue;
          const cleanT = canonicalizeDealTitle(g.title.replace(/\s*\(.*?\)\s*/g, '').trim());
          if (cleanT.length < 7) continue;
          const rx = new RegExp(`\\b${escapeRegExp(cleanT)}\\b(?!(?:\\s+(?:2|3|4|5|6|ii|iii|iv|v|vi|ragnarok|eternal|remake|part)))`, 'i');
          if (rx.test(haystack)) {
            const payload = {
              title: g.title,
              tier,
              note: `Neu im PlayStation Plus ${tier} Katalog (PS Blog DE)`
            };
            result.psPlus[g.id] = payload;
            registerTitleIndex(g.title, 'psPlus', payload);
          }
        }
      }
    }
  } catch (e) {
    console.warn('PS Blog DE RSS Hinweis:', e.message);
  }

  result.sources.psPlus = Object.keys(result.psPlus).length > 0;
  console.log(`✓ PS Plus DE Titel aktiv: ${Object.keys(result.psPlus).length}`);
}

await fetchSteamDeSales();
await fetchPsStoreDeSales();
await fetchPsPlusDeUpdates();

fs.writeFileSync(outPath, JSON.stringify(result, null, 2), 'utf8');
console.log(`✓ deals.json (Schema v3) erfolgreich geschrieben (${fs.statSync(outPath).size} Bytes).`);
