const $ = (selector) => document.querySelector(selector);
const DATA_URL = new URL('data/imoveis-brasil.json', document.baseURI).toString();
const APP_BASE_URL = new URL('./', document.baseURI).toString();

const els = {
  refreshButton: $('#refreshButton'), notificationButton: $('#notificationButton'),
  totalStat: $('#totalStat'), filteredStat: $('#filteredStat'), newStat: $('#newStat'), discountStat: $('#discountStat'),
  sourceLine: $('#sourceLine'), searchInput: $('#searchInput'), stateSelect: $('#stateSelect'), citySelect: $('#citySelect'), neighborhoodSelect: $('#neighborhoodSelect'),
  typeSelect: $('#typeSelect'), sortSelect: $('#sortSelect'), minPriceInput: $('#minPriceInput'), maxPriceInput: $('#maxPriceInput'),
  minDiscountInput: $('#minDiscountInput'), bedroomsSelect: $('#bedroomsSelect'), bathroomsSelect: $('#bathroomsSelect'), parkingSelect: $('#parkingSelect'),
  financingSelect: $('#financingSelect'), modalitySelect: $('#modalitySelect'), minAreaInput: $('#minAreaInput'), maxAreaInput: $('#maxAreaInput'),
  onlyNewInput: $('#onlyNewInput'), onlyFavoritesInput: $('#onlyFavoritesInput'), clearFilters: $('#clearFilters'),
  shareSearchButton: $('#shareSearchButton'), exportCsvButton: $('#exportCsvButton'), activeFilters: $('#activeFilters'), advancedFilters: $('#advancedFilters'),
  useCurrentFiltersButton: $('#useCurrentFiltersButton'), alertActionButton: $('#alertActionButton'), alertStatus: $('#alertStatus'),
  loadingState: $('#loadingState'), errorState: $('#errorState'), errorText: $('#errorText'), emptyState: $('#emptyState'),
  cardsGrid: $('#cardsGrid'), loadMoreButton: $('#loadMoreButton'), retryButton: $('#retryButton'), resultsMeta: $('#resultsMeta'), toast: $('#toast'),
  favoritesShortcut: $('#favoritesShortcut'), bestDiscountShortcut: $('#bestDiscountShortcut'), financingShortcut: $('#financingShortcut'), favoriteCount: $('#favoriteCount'),
};

const STORAGE = {
  seen: 'radarCaixaBR.seen.v3', favorites: 'radarCaixaBR.favorites.v1',
  alertProfile: 'radarCaixaBR.alertProfile.v3', alertsEnabled: 'radarCaixaBR.alerts.v3',
};
const LEGACY = {
  seen: 'radarCaixaBA.seen.v2', favorites: 'radarCaixaBA.favorites.v1',
  alertProfile: 'radarCaixaBA.alertProfile.v2', alertsEnabled: 'radarCaixaBA.alerts.v2',
};

const UF_NAMES = {
  AC:'Acre',AL:'Alagoas',AP:'Amapá',AM:'Amazonas',BA:'Bahia',CE:'Ceará',DF:'Distrito Federal',ES:'Espírito Santo',
  GO:'Goiás',MA:'Maranhão',MT:'Mato Grosso',MS:'Mato Grosso do Sul',MG:'Minas Gerais',PA:'Pará',PB:'Paraíba',PR:'Paraná',
  PE:'Pernambuco',PI:'Piauí',RJ:'Rio de Janeiro',RN:'Rio Grande do Norte',RS:'Rio Grande do Sul',RO:'Rondônia',RR:'Roraima',
  SC:'Santa Catarina',SP:'São Paulo',SE:'Sergipe',TO:'Tocantins'
};

const state = {
  properties: [], filtered: [], newIds: new Set(), seenAt: {}, favorites: new Set(), visibleCount: 24,
  fetchedAt: null, updatedAt: null, statesMeta: [], loading: false, workerRegistration: null, optionsReady: false,
};

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 });
const numberFormat = new Intl.NumberFormat('pt-BR');
const dateFormat = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

function safeJson(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }
function escapeHtml(value = '') { return String(value).replace(/[&<>'"]/g, (char) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;' }[char])); }
function normalize(value = '') { return String(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }
function formatMoney(value) { return Number.isFinite(value) ? brl.format(value) : 'Sob consulta'; }
function formatNumber(value, digits = 0) { return Number.isFinite(value) ? value.toLocaleString('pt-BR', { maximumFractionDigits: digits }) : '—'; }
function formatDate(value) { if (!value) return '—'; const d = new Date(value.length === 10 ? `${value}T12:00:00-03:00` : value); return Number.isNaN(d.getTime()) ? '—' : dateFormat.format(d); }
function isTruthyYes(value) { const n = normalize(value); return n.includes('sim') || n.includes('permit') || n.includes('aceit'); }
function isTruthyNo(value) { const n = normalize(value); return n.includes('nao') || n.includes('não'); }
function uniqueSorted(values) { return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), 'pt-BR')); }
function optionsHtml(values, allLabel, formatter = v => v) { return `<option value="">${escapeHtml(allLabel)}</option>${values.map(v => `<option value="${escapeHtml(v)}">${escapeHtml(formatter(v))}</option>`).join('')}`; }
function propKey(p) { return `${p.uf || ''}:${p.numeroImovel || ''}`; }

function showToast(message) {
  els.toast.textContent = message; els.toast.classList.add('show'); clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => els.toast.classList.remove('show'), 3200);
}

function setLoading(loading) {
  state.loading = loading; els.refreshButton.disabled = loading;
  const icon = els.refreshButton.querySelector('.button-icon'); if (icon) icon.textContent = loading ? '…' : '↻';
  els.loadingState.classList.toggle('hidden', !loading);
  if (loading) { els.errorState.classList.add('hidden'); els.emptyState.classList.add('hidden'); els.cardsGrid.classList.add('hidden'); els.loadMoreButton.classList.add('hidden'); }
}

function parseDescriptionFallback(p) {
  const text = String(p.descricao || '');
  if (!p.tipoImovel && text.includes(',')) p.tipoImovel = text.split(',', 1)[0].trim();
  const getInt = (re) => { const m = text.match(re); return m ? Number(m[1]) : null; };
  const getFloat = (re) => { const m = text.match(re); return m ? Number(String(m[1]).replace('.', '').replace(',', '.')) : null; };
  if (!Number.isFinite(p.quartos)) p.quartos = getInt(/(\d+)\s*qto\(s\)/i);
  if (!Number.isFinite(p.vagas)) p.vagas = getInt(/(\d+)\s*vaga\(s\)/i);
  if (!Number.isFinite(p.banheiros)) { const explicit = getInt(/(\d+)\s*(?:WC|banheiro)/i); p.banheiros = explicit ?? ((text.match(/\bWC\b/gi) || []).length || null); }
  if (!Number.isFinite(p.areaTotal)) p.areaTotal = getFloat(/([\d.,]+)\s+de\s+[aá]rea\s+total/i);
  if (!Number.isFinite(p.areaPrivativa)) p.areaPrivativa = getFloat(/([\d.,]+)\s+de\s+[aá]rea\s+privativa/i);
  if (!Number.isFinite(p.areaTerreno)) p.areaTerreno = getFloat(/([\d.,]+)\s+de\s+[aá]rea\s+(?:do\s+)?terreno/i);
  if (!Number.isFinite(p.precoM2) && Number.isFinite(p.preco) && Number.isFinite(p.areaPrivativa) && p.areaPrivativa > 0) p.precoM2 = Math.round((p.preco / p.areaPrivativa) * 100) / 100;
  return p;
}

function loadLocalState() {
  if (!localStorage.getItem(STORAGE.seen) && localStorage.getItem(LEGACY.seen)) localStorage.setItem(STORAGE.seen, localStorage.getItem(LEGACY.seen));
  if (!localStorage.getItem(STORAGE.favorites) && localStorage.getItem(LEGACY.favorites)) localStorage.setItem(STORAGE.favorites, localStorage.getItem(LEGACY.favorites));
  if (!localStorage.getItem(STORAGE.alertProfile) && localStorage.getItem(LEGACY.alertProfile)) {
    const old = safeJson(localStorage.getItem(LEGACY.alertProfile), {}) || {};
    localStorage.setItem(STORAGE.alertProfile, JSON.stringify({ state:'BA', ...old }));
  }
  if (!localStorage.getItem(STORAGE.alertsEnabled) && localStorage.getItem(LEGACY.alertsEnabled)) localStorage.setItem(STORAGE.alertsEnabled, localStorage.getItem(LEGACY.alertsEnabled));
  state.seenAt = safeJson(localStorage.getItem(STORAGE.seen), {}) || {};
  state.favorites = new Set(safeJson(localStorage.getItem(STORAGE.favorites), []) || []);
}

function reconcileSeen(properties) {
  const hadBaseline = Object.keys(state.seenAt).length > 0;
  const now = new Date().toISOString(); state.newIds = new Set();
  for (const property of properties) {
    parseDescriptionFallback(property);
    const key = propKey(property); const firstSeenGlobal = property.firstSeen ? `${property.firstSeen}T12:00:00-03:00` : null;
    const locallyUnseen = !state.seenAt[key]; if (locallyUnseen) state.seenAt[key] = firstSeenGlobal || now;
    property.detectedAt = firstSeenGlobal || state.seenAt[key]; property.isNew = Boolean(property.newOnLatestUpdate) || (hadBaseline && locallyUnseen);
    if (property.isNew) state.newIds.add(key);
  }
  localStorage.setItem(STORAGE.seen, JSON.stringify(state.seenAt));
}

function populatePrimaryOptions() {
  const states = uniqueSorted(state.properties.map(p => p.uf));
  const types = uniqueSorted(state.properties.map(p => p.tipoImovel));
  const modalities = uniqueSorted(state.properties.map(p => p.modalidade));
  els.stateSelect.innerHTML = optionsHtml(states, 'Todos os estados', uf => `${UF_NAMES[uf] || uf} (${uf})`);
  els.typeSelect.innerHTML = optionsHtml(types, 'Todos os tipos');
  els.modalitySelect.innerHTML = optionsHtml(modalities, 'Todas as modalidades');
  state.optionsReady = true;
}

function populateCities(preserve = true) {
  const current = preserve ? els.citySelect.value : ''; const uf = els.stateSelect.value;
  const cities = uniqueSorted(state.properties.filter(p => !uf || p.uf === uf).map(p => p.cidade));
  els.citySelect.innerHTML = optionsHtml(cities, 'Todas as cidades');
  if (current && cities.includes(current)) els.citySelect.value = current;
}

function populateNeighborhoods(preserve = true) {
  const current = preserve ? els.neighborhoodSelect.value : ''; const uf = els.stateSelect.value; const city = els.citySelect.value;
  const neighborhoods = uniqueSorted(state.properties.filter(p => (!uf || p.uf === uf) && (!city || p.cidade === city)).map(p => p.bairro));
  els.neighborhoodSelect.innerHTML = optionsHtml(neighborhoods, 'Todos os bairros');
  if (current && neighborhoods.includes(current)) els.neighborhoodSelect.value = current;
}

function getFilters() {
  return {
    q: els.searchInput.value.trim(), state: els.stateSelect.value, city: els.citySelect.value, neighborhood: els.neighborhoodSelect.value, type: els.typeSelect.value,
    sort: els.sortSelect.value, minPrice: Number(els.minPriceInput.value || 0), maxPrice: Number(els.maxPriceInput.value || 0),
    minDiscount: Number(els.minDiscountInput.value || 0), bedrooms: Number(els.bedroomsSelect.value || 0), bathrooms: Number(els.bathroomsSelect.value || 0),
    parking: Number(els.parkingSelect.value || 0), financing: els.financingSelect.value, modality: els.modalitySelect.value,
    minArea: Number(els.minAreaInput.value || 0), maxArea: Number(els.maxAreaInput.value || 0), onlyNew: els.onlyNewInput.checked, onlyFavorites: els.onlyFavoritesInput.checked,
  };
}

function matchesProfile(p, f) {
  if (f.state && p.uf !== f.state) return false;
  if (f.city && p.cidade !== f.city) return false;
  if (f.neighborhood && p.bairro !== f.neighborhood) return false;
  if (f.type && p.tipoImovel !== f.type) return false;
  if (f.modality && p.modalidade !== f.modality) return false;
  if (f.minPrice > 0 && (!Number.isFinite(p.preco) || p.preco < f.minPrice)) return false;
  if (f.maxPrice > 0 && (!Number.isFinite(p.preco) || p.preco > f.maxPrice)) return false;
  if (f.minDiscount > 0 && (!Number.isFinite(p.desconto) || p.desconto < f.minDiscount)) return false;
  if (f.bedrooms > 0 && (!Number.isFinite(p.quartos) || p.quartos < f.bedrooms)) return false;
  if (f.bathrooms > 0 && (!Number.isFinite(p.banheiros) || p.banheiros < f.bathrooms)) return false;
  if (f.parking > 0 && (!Number.isFinite(p.vagas) || p.vagas < f.parking)) return false;
  if (f.minArea > 0 && (!Number.isFinite(p.areaPrivativa) || p.areaPrivativa < f.minArea)) return false;
  if (f.maxArea > 0 && (!Number.isFinite(p.areaPrivativa) || p.areaPrivativa > f.maxArea)) return false;
  if (f.financing === 'sim' && !isTruthyYes(p.financiamento)) return false;
  if (f.financing === 'nao' && !isTruthyNo(p.financiamento)) return false;
  return true;
}

function filterLabels(f) {
  const items = [];
  if (f.q) items.push(`Busca: ${f.q}`); if (f.state) items.push(`${UF_NAMES[f.state] || f.state} (${f.state})`); if (f.city) items.push(f.city); if (f.neighborhood) items.push(f.neighborhood); if (f.type) items.push(f.type);
  if (f.minPrice) items.push(`≥ ${formatMoney(f.minPrice)}`); if (f.maxPrice) items.push(`≤ ${formatMoney(f.maxPrice)}`); if (f.minDiscount) items.push(`${f.minDiscount}%+ desconto`);
  if (f.bedrooms) items.push(`${f.bedrooms}+ quartos`); if (f.bathrooms) items.push(`${f.bathrooms}+ WC`); if (f.parking) items.push(`${f.parking}+ vagas`);
  if (f.financing === 'sim') items.push('Com financiamento'); if (f.financing === 'nao') items.push('Sem financiamento'); if (f.modality) items.push(f.modality);
  if (f.minArea) items.push(`${f.minArea} m²+`); if (f.maxArea) items.push(`até ${f.maxArea} m²`); if (f.onlyNew) items.push('Somente novos'); if (f.onlyFavorites) items.push('Favoritos');
  return items;
}

function updateActiveFilters(f) {
  const labels = filterLabels(f); els.activeFilters.classList.toggle('hidden', !labels.length);
  els.activeFilters.innerHTML = labels.map(x => `<span>${escapeHtml(x)}</span>`).join('');
}

function syncUrl(f) {
  const params = new URLSearchParams();
  const map = { q:f.q, uf:f.state, city:f.city, bairro:f.neighborhood, type:f.type, sort:f.sort !== 'recent' ? f.sort : '', minPrice:f.minPrice || '', maxPrice:f.maxPrice || '', minDiscount:f.minDiscount || '', beds:f.bedrooms || '', baths:f.bathrooms || '', parking:f.parking || '', financing:f.financing, modality:f.modality, minArea:f.minArea || '', maxArea:f.maxArea || '', new:f.onlyNew ? '1' : '', fav:f.onlyFavorites ? '1' : '' };
  Object.entries(map).forEach(([k, v]) => { if (v !== '' && v !== null && v !== undefined) params.set(k, String(v)); });
  const url = new URL(location.href); url.search = params.toString(); history.replaceState(null, '', url);
}

function restoreFiltersFromUrl() {
  const p = new URLSearchParams(location.search);
  els.searchInput.value = p.get('q') || ''; els.stateSelect.value = p.get('uf') || ''; populateCities(false); els.citySelect.value = p.get('city') || ''; populateNeighborhoods(false); els.neighborhoodSelect.value = p.get('bairro') || '';
  els.typeSelect.value = p.get('type') || ''; els.sortSelect.value = p.get('sort') || 'recent'; els.minPriceInput.value = p.get('minPrice') || ''; els.maxPriceInput.value = p.get('maxPrice') || '';
  els.minDiscountInput.value = p.get('minDiscount') || ''; els.bedroomsSelect.value = p.get('beds') || ''; els.bathroomsSelect.value = p.get('baths') || ''; els.parkingSelect.value = p.get('parking') || '';
  els.financingSelect.value = p.get('financing') || ''; els.modalitySelect.value = p.get('modality') || ''; els.minAreaInput.value = p.get('minArea') || ''; els.maxAreaInput.value = p.get('maxArea') || '';
  els.onlyNewInput.checked = p.get('new') === '1'; els.onlyFavoritesInput.checked = p.get('fav') === '1';
  if ([els.financingSelect.value, els.modalitySelect.value, els.minAreaInput.value, els.maxAreaInput.value, els.onlyNewInput.checked, els.onlyFavoritesInput.checked].some(Boolean)) els.advancedFilters.open = true;
}

function applyFilters({ sync = true } = {}) {
  const f = getFilters(); const search = normalize(f.q);
  const filtered = state.properties.filter((p) => {
    if (!matchesProfile(p, f)) return false;
    if (f.onlyNew && !p.isNew) return false;
    if (f.onlyFavorites && !state.favorites.has(propKey(p))) return false;
    if (search) { const haystack = normalize([p.numeroImovel,p.uf,p.cidade,p.bairro,p.endereco,p.modalidade,p.descricao,p.financiamento,p.tipoImovel].join(' ')); if (!haystack.includes(search)) return false; }
    return true;
  });
  filtered.sort((a, b) => {
    if (f.sort === 'price-asc') return (a.preco ?? Infinity) - (b.preco ?? Infinity);
    if (f.sort === 'price-desc') return (b.preco ?? -1) - (a.preco ?? -1);
    if (f.sort === 'discount-desc') return (b.desconto ?? -1) - (a.desconto ?? -1);
    if (f.sort === 'sqm-asc') return (a.precoM2 ?? Infinity) - (b.precoM2 ?? Infinity);
    if (f.sort === 'area-desc') return (b.areaPrivativa ?? -1) - (a.areaPrivativa ?? -1);
    return String(b.firstSeen || '').localeCompare(String(a.firstSeen || '')) || (b.isNew ? 1 : 0) - (a.isNew ? 1 : 0) || String(b.numeroImovel).localeCompare(String(a.numeroImovel));
  });
  state.filtered = filtered; state.visibleCount = 24; updateActiveFilters(f); if (sync) syncUrl(f); render();
}

function renderStats() {
  els.totalStat.textContent = numberFormat.format(state.properties.length); els.filteredStat.textContent = numberFormat.format(state.filtered.length); els.newStat.textContent = numberFormat.format([...state.newIds].length);
  const discounts = state.filtered.map(p => p.desconto).filter(Number.isFinite); els.discountStat.textContent = discounts.length ? `${Math.max(...discounts).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%` : '—';
  els.favoriteCount.textContent = `${state.favorites.size} ${state.favorites.size === 1 ? 'salvo' : 'salvos'}`;
}

function featureChips(p) {
  const chips = [];
  if (p.tipoImovel) chips.push(p.tipoImovel); if (Number.isFinite(p.quartos)) chips.push(`${p.quartos} qto${p.quartos === 1 ? '' : 's'}`); if (Number.isFinite(p.banheiros)) chips.push(`${p.banheiros} WC`);
  if (Number.isFinite(p.vagas) && p.vagas > 0) chips.push(`${p.vagas} vaga${p.vagas === 1 ? '' : 's'}`); if (Number.isFinite(p.areaPrivativa) && p.areaPrivativa > 0) chips.push(`${formatNumber(p.areaPrivativa, 1)} m² priv.`);
  return chips.map(x => `<span>${escapeHtml(x)}</span>`).join('');
}

function propertyCard(p) {
  const key = propKey(p); const favorite = state.favorites.has(key); const modality = p.modalidade || 'Modalidade não informada';
  const discount = Number.isFinite(p.desconto) ? `${p.desconto.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}% abaixo da avaliação` : 'Desconto não informado';
  const detected = p.isNew ? `Novo em ${formatDate(p.detectedAt)}` : `Detectado em ${formatDate(p.detectedAt)}`;
  const mapQuery = encodeURIComponent([p.endereco,p.bairro,p.cidade,p.uf,'Brasil'].filter(Boolean).join(', '));
  return `<article class="property-card" data-id="${escapeHtml(key)}">
    <div class="card-top"><div class="card-badges"><span class="badge badge--modality" title="${escapeHtml(modality)}">${escapeHtml(modality)}</span><div class="card-badge-actions">${p.isNew ? '<span class="badge badge--new">Novo</span>' : ''}<button class="favorite-button ${favorite ? 'is-favorite' : ''}" data-favorite="${escapeHtml(key)}" type="button" title="${favorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}" aria-label="Favorito">♥</button></div></div>
      <div class="card-city">${escapeHtml(p.cidade)} • ${escapeHtml(p.uf)}</div><h3 class="card-neighborhood">${escapeHtml(p.bairro || 'Bairro não informado')}</h3>
      <div class="property-features">${featureChips(p)}</div><span class="price-label">Preço de venda</span><div class="price-row"><span class="price">${formatMoney(p.preco)}</span><span class="discount">${escapeHtml(discount)}</span></div>${Number.isFinite(p.precoM2) ? `<div class="sqm-price">${formatMoney(p.precoM2)} / m² privativo</div>` : ''}</div>
    <div class="card-body"><div class="info-grid"><div class="info-item"><span>Avaliação</span><strong>${escapeHtml(formatMoney(p.valorAvaliacao))}</strong></div><div class="info-item"><span>Nº do imóvel</span><strong>${escapeHtml(p.numeroImovel)}</strong></div><div class="info-item"><span>Financiamento</span><strong>${escapeHtml(p.financiamento || 'Consulte')}</strong></div><div class="info-item"><span>Área total</span><strong>${Number.isFinite(p.areaTotal) ? `${escapeHtml(formatNumber(p.areaTotal, 1))} m²` : '—'}</strong></div></div>
      <div class="address">${escapeHtml(p.endereco || 'Endereço disponível na página oficial.')}</div><div class="description">${escapeHtml(p.descricao || 'Consulte a descrição completa no anúncio oficial da CAIXA.')}</div><div class="card-footer"><span class="detected-date">${escapeHtml(detected)}</span><div class="card-links"><a class="card-link card-link--secondary" href="https://www.google.com/maps/search/?api=1&query=${mapQuery}" target="_blank" rel="noopener noreferrer">Mapa ↗</a><a class="card-link" href="${escapeHtml(p.link)}" target="_blank" rel="noopener noreferrer">Ver na CAIXA ↗</a></div></div></div></article>`;
}

function renderCards() {
  const hasResults = state.filtered.length > 0; els.emptyState.classList.toggle('hidden', hasResults || state.loading); els.cardsGrid.classList.toggle('hidden', !hasResults || state.loading);
  if (!hasResults) { els.cardsGrid.innerHTML = ''; els.loadMoreButton.classList.add('hidden'); return; }
  const visible = state.filtered.slice(0, state.visibleCount); els.cardsGrid.innerHTML = visible.map(propertyCard).join('');
  els.loadMoreButton.classList.toggle('hidden', visible.length >= state.filtered.length); els.loadMoreButton.textContent = `Mostrar mais (${numberFormat.format(state.filtered.length - visible.length)})`;
}

function renderMeta() {
  const f = getFilters(); const parts = [];
  if (f.state) parts.push(UF_NAMES[f.state] || f.state); if (f.city) parts.push(f.city); if (f.type) parts.push(f.type); parts.push(`${numberFormat.format(state.filtered.length)} resultado${state.filtered.length === 1 ? '' : 's'}`);
  els.resultsMeta.textContent = parts.join(' • ');
}
function render() { renderStats(); renderCards(); renderMeta(); updateAlertUi(); }

function updateSourceLine() {
  const statesCount = state.statesMeta.length || uniqueSorted(state.properties.map(p => p.uf)).length; const fetched = state.fetchedAt ? formatDate(state.fetchedAt) : null;
  els.sourceLine.textContent = `Fonte oficial CAIXA • ${statesCount} UFs • ${numberFormat.format(state.properties.length)} imóveis carregados${fetched ? ` • atualização ${fetched}` : ''}`;
}

function toggleFavorite(key) {
  if (state.favorites.has(key)) state.favorites.delete(key); else state.favorites.add(key);
  localStorage.setItem(STORAGE.favorites, JSON.stringify([...state.favorites])); render();
}

function clearFilters() {
  els.searchInput.value = ''; els.stateSelect.value = ''; populateCities(false); els.citySelect.value = ''; populateNeighborhoods(false); els.typeSelect.value = ''; els.sortSelect.value = 'recent'; els.minPriceInput.value = ''; els.maxPriceInput.value = ''; els.minDiscountInput.value = '';
  els.bedroomsSelect.value = ''; els.bathroomsSelect.value = ''; els.parkingSelect.value = ''; els.financingSelect.value = ''; els.modalitySelect.value = ''; els.minAreaInput.value = ''; els.maxAreaInput.value = ''; els.onlyNewInput.checked = false; els.onlyFavoritesInput.checked = false;
  els.advancedFilters.open = false; applyFilters();
}

function csvEscape(value) { const s = String(value ?? ''); return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }
function exportCsv() {
  if (!state.filtered.length) return showToast('Não há resultados para exportar.');
  const cols = [['UF','uf'],['Nº imóvel','numeroImovel'],['Cidade','cidade'],['Bairro','bairro'],['Tipo','tipoImovel'],['Endereço','endereco'],['Preço','preco'],['Avaliação','valorAvaliacao'],['Desconto %','desconto'],['Quartos','quartos'],['WC','banheiros'],['Vagas','vagas'],['Área privativa m²','areaPrivativa'],['Área total m²','areaTotal'],['Preço/m²','precoM2'],['Financiamento','financiamento'],['Modalidade','modalidade'],['Primeira detecção','firstSeen'],['Link CAIXA','link']];
  const rows = [cols.map(c => c[0]).join(';'), ...state.filtered.map(p => cols.map(([,k]) => csvEscape(p[k])).join(';'))];
  const blob = new Blob(['\ufeff' + rows.join('\n')], { type: 'text/csv;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `radar-caixa-brasil-${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(a.href);
  showToast(`${state.filtered.length} imóveis exportados.`);
}

async function shareSearch() {
  syncUrl(getFilters()); const url = location.href;
  try { if (navigator.share) await navigator.share({ title: 'Radar de Imóveis CAIXA - Brasil', text: 'Veja esta pesquisa de imóveis da CAIXA:', url }); else { await navigator.clipboard.writeText(url); showToast('Link da pesquisa copiado.'); } }
  catch (error) { if (error?.name !== 'AbortError') showToast('Não foi possível compartilhar automaticamente.'); }
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null;
  try { state.workerRegistration = await navigator.serviceWorker.register(new URL('sw.js', APP_BASE_URL), { scope: APP_BASE_URL }); return state.workerRegistration; }
  catch (error) { console.warn('Service Worker:', error); return null; }
}
function workerMessage(message) { const worker = state.workerRegistration?.active || state.workerRegistration?.waiting || state.workerRegistration?.installing; worker?.postMessage(message); }
function alertProfile() { return safeJson(localStorage.getItem(STORAGE.alertProfile), {}) || {}; }
function profileSummary(profile) { const labels = filterLabels({ ...profile, q: '', sort: 'recent', onlyNew: false, onlyFavorites: false }); return labels.length ? labels.slice(0, 4).join(' • ') + (labels.length > 4 ? ` • +${labels.length - 4}` : '') : 'todo o Brasil'; }
function currentFiltersAsAlertProfile() { const f = getFilters(); return { state:f.state, city:f.city, neighborhood:f.neighborhood, type:f.type, minPrice:f.minPrice, maxPrice:f.maxPrice, minDiscount:f.minDiscount, bedrooms:f.bedrooms, bathrooms:f.bathrooms, parking:f.parking, financing:f.financing, modality:f.modality, minArea:f.minArea, maxArea:f.maxArea }; }

async function syncWorkerState() {
  if (!state.workerRegistration) await registerServiceWorker(); workerMessage({ type: 'SYNC_CURRENT', ids: state.properties.map(propKey), alertProfile: alertProfile() });
}

async function notifyNewPropertiesIfNeeded() {
  if (!('Notification' in window) || Notification.permission !== 'granted' || localStorage.getItem(STORAGE.alertsEnabled) !== '1') return;
  const profile = alertProfile(); const newItems = state.properties.filter(p => p.isNew && matchesProfile(p, profile)); if (!newItems.length) return;
  const registration = state.workerRegistration || await registerServiceWorker(); if (!registration) return;
  await registration.showNotification('Novos imóveis compatíveis na CAIXA', { body: `${newItems.length} ${newItems.length === 1 ? 'novo imóvel atende' : 'novos imóveis atendem'} ao seu alerta (${profileSummary(profile)}).`, icon: new URL('icons/icon-192.png', APP_BASE_URL).toString(), badge: new URL('icons/icon-192.png', APP_BASE_URL).toString(), tag: 'radar-caixa-br-new', renotify: true, data: { url: location.href } });
}

async function enableNotifications() {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) return showToast('Este navegador não oferece notificações para este aplicativo.');
  const permission = await Notification.requestPermission(); if (permission !== 'granted') { localStorage.setItem(STORAGE.alertsEnabled, '0'); updateAlertUi(); return showToast('Notificações não foram autorizadas.'); }
  const registration = state.workerRegistration || await registerServiceWorker(); localStorage.setItem(STORAGE.alertsEnabled, '1');
  if (!localStorage.getItem(STORAGE.alertProfile)) localStorage.setItem(STORAGE.alertProfile, JSON.stringify(currentFiltersAsAlertProfile()));
  let periodic = false; try { if (registration?.periodicSync) { await registration.periodicSync.register('check-properties', { minInterval: 24 * 60 * 60 * 1000 }); periodic = true; } } catch (e) { console.info('Periodic Background Sync indisponível:', e); }
  workerMessage({ type: 'SET_ALERT_PROFILE', alertProfile: alertProfile() }); updateAlertUi(periodic); showToast(periodic ? 'Alertas em segundo plano ativados.' : 'Alertas ativados; a checagem ocorrerá ao abrir o app.');
}
function disableNotifications() { localStorage.setItem(STORAGE.alertsEnabled, '0'); updateAlertUi(); showToast('Alertas do navegador desativados.'); }
function updateAlertUi(periodicOverride = null) {
  const supported = 'Notification' in window; const enabled = supported && localStorage.getItem(STORAGE.alertsEnabled) === '1' && Notification.permission === 'granted';
  els.alertActionButton.textContent = enabled ? 'Desativar' : 'Ativar'; els.notificationButton.innerHTML = enabled ? '<span class="button-icon">✓</span> Alertas ativos' : '<span class="button-icon">◉</span> Ativar alertas';
  const profile = alertProfile();
  if (!supported) els.alertStatus.textContent = 'Este navegador não oferece notificações web.';
  else if (!enabled) els.alertStatus.textContent = `Perfil do alerta: ${profileSummary(profile)}. Ative para receber avisos neste navegador.`;
  else if (periodicOverride === false) els.alertStatus.textContent = `Alertas ativos para ${profileSummary(profile)}. A comparação ocorrerá quando o aplicativo for aberto.`;
  else els.alertStatus.textContent = `Alertas ativos para ${profileSummary(profile)}. O navegador tentará verificar novas oportunidades em segundo plano.`;
}
function useCurrentFiltersForAlert() { const p = currentFiltersAsAlertProfile(); localStorage.setItem(STORAGE.alertProfile, JSON.stringify(p)); workerMessage({ type: 'SET_ALERT_PROFILE', alertProfile: p }); updateAlertUi(); showToast('Os filtros atuais foram salvos como perfil do alerta.'); }

async function fetchProperties(force = false) {
  setLoading(true);
  try {
    const response = await fetch(`${DATA_URL}${force ? `?refresh=${Date.now()}` : ''}`, { cache: force ? 'no-store' : 'default' }); const payload = await response.json(); if (!response.ok) throw new Error(payload.detail || payload.error || 'Falha ao consultar a lista.');
    state.properties = Array.isArray(payload.properties) ? payload.properties : []; state.statesMeta = Array.isArray(payload.states) ? payload.states : []; state.fetchedAt = payload.fetchedAt || new Date().toISOString(); state.updatedAt = payload.updatedAt || null; reconcileSeen(state.properties);
    populatePrimaryOptions(); populateCities(false); populateNeighborhoods(false); restoreFiltersFromUrl(); applyFilters({ sync: false }); updateSourceLine(); els.errorState.classList.add('hidden'); await notifyNewPropertiesIfNeeded(); await syncWorkerState(); if (force) showToast('Dados nacionais publicados verificados.');
  } catch (error) {
    console.error(error); els.errorText.textContent = error instanceof Error ? error.message : 'Tente novamente em instantes.'; els.errorState.classList.remove('hidden'); els.cardsGrid.classList.add('hidden'); els.emptyState.classList.add('hidden'); els.sourceLine.textContent = 'Não foi possível consultar as listas oficiais agora.';
  } finally { setLoading(false); if (state.properties.length) render(); }
}

function attachEvents() {
  const inputs = [els.searchInput, els.typeSelect, els.sortSelect, els.minPriceInput, els.maxPriceInput, els.minDiscountInput, els.bedroomsSelect, els.bathroomsSelect, els.parkingSelect, els.financingSelect, els.modalitySelect, els.minAreaInput, els.maxAreaInput, els.onlyNewInput, els.onlyFavoritesInput];
  inputs.forEach(control => control.addEventListener((control.tagName === 'INPUT' && control.type !== 'checkbox') ? 'input' : 'change', () => applyFilters()));
  els.stateSelect.addEventListener('change', () => { populateCities(false); populateNeighborhoods(false); applyFilters(); });
  els.citySelect.addEventListener('change', () => { populateNeighborhoods(false); applyFilters(); }); els.neighborhoodSelect.addEventListener('change', () => applyFilters());
  els.clearFilters.addEventListener('click', clearFilters); els.refreshButton.addEventListener('click', () => fetchProperties(true)); els.retryButton.addEventListener('click', () => fetchProperties(true));
  els.loadMoreButton.addEventListener('click', () => { state.visibleCount += 24; renderCards(); }); els.exportCsvButton.addEventListener('click', exportCsv); els.shareSearchButton.addEventListener('click', shareSearch);
  els.cardsGrid.addEventListener('click', e => { const btn = e.target.closest('[data-favorite]'); if (btn) { e.preventDefault(); toggleFavorite(btn.dataset.favorite); } });
  els.favoritesShortcut.addEventListener('click', () => { els.onlyFavoritesInput.checked = !els.onlyFavoritesInput.checked; els.advancedFilters.open = true; applyFilters(); });
  els.bestDiscountShortcut.addEventListener('click', () => { els.sortSelect.value = 'discount-desc'; applyFilters(); });
  els.financingShortcut.addEventListener('click', () => { els.financingSelect.value = 'sim'; els.advancedFilters.open = true; applyFilters(); });
  els.useCurrentFiltersButton.addEventListener('click', useCurrentFiltersForAlert);
  els.alertActionButton.addEventListener('click', () => { const enabled = 'Notification' in window && localStorage.getItem(STORAGE.alertsEnabled) === '1' && Notification.permission === 'granted'; if (enabled) disableNotifications(); else enableNotifications(); });
  els.notificationButton.addEventListener('click', enableNotifications);
}

async function init() { loadLocalState(); attachEvents(); await registerServiceWorker(); updateAlertUi(); await fetchProperties(false); }
init();
