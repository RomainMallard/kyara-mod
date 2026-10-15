// ==UserScript==
// @name         Kyara Mod
// @namespace    kyara-mod
// @version      0.19.0
// @description  UI tweaks for kyara.games, toggleable from the profile menu.
// @match        https://kyara.games/*
// @match        file:///*Kyara*
// @updateURL    https://raw.githubusercontent.com/RomainMallard/kyara-mod/main/kyara-mod.user.js
// @downloadURL  https://raw.githubusercontent.com/RomainMallard/kyara-mod/main/kyara-mod.user.js
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // --- Shared helpers -------------------------------------------------------

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // The site authenticates API calls with a bearer token kept in localStorage.
  // Read it per request so a refreshed token is picked up.
  function api(path, method = 'GET') {
    let token = null;
    try {
      token = localStorage.getItem('kyara_token');
      if (token && token.startsWith('"')) token = JSON.parse(token);
    } catch {}
    if (!token) return Promise.reject(new Error('no kyara_token (logged out?)'));
    return fetch(path, { method, headers: { Authorization: `Bearer ${token}` } });
  }

  function findTriSelect() {
    for (const label of document.querySelectorAll('label')) {
      const span = label.querySelector('span');
      if (span && span.textContent.trim() === 'Tri') return label.querySelector('select');
    }
    return null;
  }

  // --- Feature: price sort + "Tout afficher" --------------------------------

  const priceSort = (() => {
    const PRICE_SELECTOR = 'span[title="Prix médian sur le marché"]';
    const OPTIONS = [
      { value: 'kmod-price-asc', label: 'Prix ↑', dir: 1 },
      { value: 'kmod-price-desc', label: 'Prix ↓', dir: -1 },
    ];
    let bulkLoading = false;

    // "≈ 1 200 ◆ · 1 en vente" -> 1200 ; no price -> null
    function readPrice(cell) {
      const span = cell.querySelector(PRICE_SELECTOR);
      if (!span) return null;
      const m = span.textContent.match(/([\d\s .,]+)\s*◆/);
      if (!m) return null;
      const n = parseFloat(m[1].replace(/[\s ]/g, '').replace(',', '.'));
      return Number.isFinite(n) ? n : null;
    }

    function sortGrid(dir) {
      const grid = document.querySelector('div.grid');
      if (!grid) return;
      const cells = [...grid.children].filter((el) => el.classList.contains('cell'));
      cells
        .map((cell) => ({ cell, price: readPrice(cell) }))
        .sort((a, b) => {
          if (a.price === null) return b.price === null ? 0 : 1; // unpriced last
          if (b.price === null) return -1;
          return (a.price - b.price) * dir;
        })
        .forEach(({ cell }) => grid.appendChild(cell));
    }

    const activeOption = () => {
      const select = findTriSelect();
      return select && OPTIONS.find((o) => o.value === select.value);
    };

    function resortIfActive() {
      const opt = activeOption();
      if (opt) sortGrid(opt.dir);
    }

    // The site's nav also has a "div.more" ("Plus" menu), so match by text too.
    const isMoreButton = (el) =>
      el && !el.dataset.kmod && el.textContent.trim().startsWith('Afficher plus');
    const moreButton = () => [...document.querySelectorAll('div.more > button')].find(isMoreButton);
    const countCells = () => document.querySelectorAll('div.grid > div.cell').length;

    // Resolve once the card count exceeds `before` (or after timeoutMs).
    async function waitForMoreCells(before, timeoutMs = 5000) {
      for (let t = 0; t < timeoutMs; t += 100) {
        if (countCells() > before) return true;
        await sleep(100);
      }
      return false;
    }

    // Select "change": let Svelte's own handler run first, then apply our order.
    function onSelectChange(e) {
      const opt = OPTIONS.find((o) => o.value === e.target.value);
      if (opt) requestAnimationFrame(() => setTimeout(() => sortGrid(opt.dir), 0));
    }

    // User clicks "Afficher plus" -> re-sort once new cards are in.
    // Listening on document because Svelte may replace the button element.
    async function onDocumentClick(e) {
      if (bulkLoading || !isMoreButton(e.target.closest('button'))) return;
      const before = countCells();
      if (await waitForMoreCells(before)) resortIfActive();
    }

    // "Tout afficher": click "Afficher plus" until it disappears.
    async function loadAll(ourBtn) {
      bulkLoading = true;
      ourBtn.disabled = true;
      ourBtn.textContent = 'Chargement…';
      try {
        let btn;
        while ((btn = moreButton())) {
          const before = countCells();
          btn.click();
          if (!(await waitForMoreCells(before))) break; // nothing came, stop
          await sleep(300); // be gentle in case each click hits the server
        }
      } finally {
        bulkLoading = false;
        resortIfActive();
        ourBtn.disabled = false;
        ourBtn.textContent = 'Tout afficher';
      }
    }

    function ensureSelectOptions() {
      const select = findTriSelect();
      if (!select || select.dataset.kmod) return;
      select.dataset.kmod = '1';
      for (const o of OPTIONS) select.add(new Option(o.label, o.value));
      select.addEventListener('change', onSelectChange);
    }

    // Keep our button right after the "Tri" label (Svelte may re-render that area).
    function ensureShowAllButton() {
      const select = findTriSelect();
      const label = select && select.closest('label');
      if (!label) return;
      let btn = label.parentElement.querySelector('button[data-kmod]');
      if (!btn) {
        btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'btn btn-ghost'; // the site's "Afficher plus" style
        btn.dataset.kmod = '1';
        btn.textContent = 'Tout afficher';
        btn.style.marginLeft = '8px';
        btn.style.alignSelf = 'flex-end';
        btn.addEventListener('click', () => loadAll(btn));
        label.after(btn);
      }
      // Hide it once everything is loaded (no "Afficher plus" left).
      if (!btn.disabled) btn.hidden = !moreButton();
    }

    return {
      id: 'priceSort',
      label: 'Tri par prix + « Tout afficher »',
      start() {
        document.addEventListener('click', onDocumentClick);
      },
      // Called every loader tick while enabled: (re)inject UI if the page has it.
      tick() {
        ensureSelectOptions();
        ensureShowAllButton();
      },
      stop() {
        document.removeEventListener('click', onDocumentClick);
        document.querySelectorAll('button[data-kmod]').forEach((b) => b.remove());
        const select = findTriSelect();
        if (!select || !select.dataset.kmod) return;
        const wasActive = !!activeOption();
        select.removeEventListener('change', onSelectChange);
        for (const o of OPTIONS) select.querySelector(`option[value="${o.value}"]`)?.remove();
        delete select.dataset.kmod;
        if (wasActive) {
          // Hand the order back to the site.
          select.value = 'num';
          select.dispatchEvent(new Event('change', { bubbles: true }));
        }
      },
    };
  })();

  // --- Feature: greyed-out portrait behind missing cards --------------------

  const bgFix = (() => {
    const IMG_ATTR = 'data-kmod-bg';
    const FILTER = 'grayscale() brightness(.45) blur(2px)'; // site's locked-card look

    function decorate(miss) {
      const slot = miss.closest('a.slot');
      const id = slot && (slot.getAttribute('href') || '').match(/\/wiki\/(\d+)/)?.[1];
      if (!id) return;

      const img = document.createElement('img');
      img.setAttribute(IMG_ATTR, '1');
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      img.src = `/cards/sm/${id}.webp`; // same size the site uses for owned cards
      img.style.cssText =
        `position:absolute;inset:0;width:100%;height:100%;object-fit:cover;` +
        `filter:${FILTER};z-index:0;pointer-events:none;`;
      // Fall back to plain "?"; the data-kmod-bg mark on div.miss stops retries.
      img.addEventListener('error', () => img.remove());

      miss.setAttribute(IMG_ATTR, '1');
      miss.style.position = 'relative';
      miss.style.overflow = 'hidden';
      for (const child of miss.children) {
        child.style.position = 'relative';
        child.style.zIndex = '1';
      }
      miss.prepend(img);
    }

    return {
      id: 'bgFix',
      label: 'bckgrd fix',
      tick() {
        for (const miss of document.querySelectorAll('a.slot div.miss')) {
          if (!miss.hasAttribute(IMG_ATTR)) decorate(miss);
        }
      },
      stop() {
        for (const miss of document.querySelectorAll(`div.miss[${IMG_ATTR}]`)) {
          miss.querySelector(`img[${IMG_ATTR}]`)?.remove();
          miss.removeAttribute(IMG_ATTR);
          miss.style.position = '';
          miss.style.overflow = '';
          for (const child of miss.children) {
            child.style.position = '';
            child.style.zIndex = '';
          }
        }
      },
    };
  })();

  // --- Feature: wishlist heart on missing cards ------------------------------

  const wishlist = (() => {
    const BTN_ATTR = 'data-kmod-wish';
    const HEART =
      '<svg width="16" height="16" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" ' +
      'aria-hidden="true"><path d="M12 21s-7.5-4.6-9.5-9.2C1.2 8.6 3.3 5 6.8 5c2.1 0 3.6 1.2 ' +
      '5.2 3 1.6-1.8 3.1-3 5.2-3 3.5 0 5.6 3.6 4.3 6.8C19.5 16.4 12 21 12 21z"/></svg>';
    let ids = null; // Set of wishlisted card ids; null until bootstrap answers
    let generation = 0; // bumps on stop() so late responses are ignored
    const pending = new Set();

    const cardId = (slot) => (slot.getAttribute('href') || '').match(/\/wiki\/(\d+)/)?.[1];

    function paint(btn) {
      const on = ids.has(Number(btn.getAttribute(BTN_ATTR)));
      btn.setAttribute('aria-pressed', String(on));
      btn.title = on ? 'Retirer de la wishlist' : 'Ajouter à la wishlist';
      btn.style.color = on ? '#ff5c8a' : '#fff';
      btn.querySelector('svg').setAttribute('fill', on ? 'currentColor' : 'none');
    }

    const paintAll = () => document.querySelectorAll(`button[${BTN_ATTR}]`).forEach(paint);

    async function toggle(e, btn) {
      e.preventDefault(); // the button lives inside the a.slot link
      e.stopPropagation();
      const id = Number(btn.getAttribute(BTN_ATTR));
      if (pending.has(id)) return;
      const gen = generation;
      const add = !ids.has(id);
      add ? ids.add(id) : ids.delete(id); // optimistic
      paintAll();
      pending.add(id);
      try {
        const res = await api(`/api/me/wishlist/${id}`, add ? 'PUT' : 'DELETE');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const list = await res.json().catch(() => null);
        if (gen !== generation) return;
        if (Array.isArray(list)) ids = new Set(list.map(Number)); // server is the truth
      } catch (err) {
        console.warn(`[kyara-mod] wishlist ${add ? 'PUT' : 'DELETE'} ${id} failed`, err);
        if (gen !== generation) return;
        add ? ids.delete(id) : ids.add(id); // revert
      } finally {
        pending.delete(id);
        if (gen === generation) paintAll();
      }
    }

    function decorate(slot) {
      const id = cardId(slot);
      if (!id) return;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.setAttribute(BTN_ATTR, id);
      btn.innerHTML = HEART;
      btn.style.cssText =
        'position:absolute;top:6px;right:6px;z-index:2;width:28px;height:28px;' +
        'border-radius:50%;border:none;padding:0;display:flex;align-items:center;' +
        'justify-content:center;background:rgba(0,0,0,.55);cursor:pointer;';
      btn.addEventListener('click', (e) => toggle(e, btn));
      if (getComputedStyle(slot).position === 'static') slot.style.position = 'relative';
      slot.append(btn);
      paint(btn);
    }

    return {
      id: 'wishlist',
      label: 'Wishlist sur cartes manquantes',
      async start() {
        const gen = generation;
        try {
          const res = await api('/api/me/bootstrap');
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          if (gen === generation) ids = new Set((data.wishlist || []).map(Number));
        } catch (err) {
          console.warn('[kyara-mod] wishlist bootstrap failed', err);
        }
      },
      tick() {
        if (!ids) return; // wait for bootstrap
        for (const miss of document.querySelectorAll('a.slot div.miss')) {
          const slot = miss.closest('a.slot');
          if (!slot.querySelector(`button[${BTN_ATTR}]`)) decorate(slot);
        }
      },
      stop() {
        generation++;
        ids = null;
        pending.clear();
        document.querySelectorAll(`button[${BTN_ATTR}]`).forEach((b) => b.remove());
      },
    };
  })();

  // --- Feature: trade utils (dialog filters: doubles, missing for friend) ----

  const tradeUtils = (() => {
    const BTN_ATTR = 'data-kmod-tf';
    const HIDE_CLASS = 'kmod-hide';
    // Old markup: .builder with .qty and a button.toggle.
    // New markup (site update): .shelf with .have ("×2 dispo") and .chips of button.only.
    const ROOT = ':is(.builder, .shelf)';

    function qty(tile) {
      const m = (tile.querySelector('.qty, .have')?.textContent || '').match(/(\d+)/);
      return m ? Number(m[1]) : 0;
    }

    // keep(tile) -> false hides it. A tile shows only if every active filter keeps it.
    // `active` is remembered across dialog opens until page reload.
    // Friend's tradable cards (GET /api/trades/available/<uuid>), fetched on dialog open.
    // Absent from the list = we treat it as missing for them.
    let friendIds = null; // Set of characterIds; null until loaded / on failure
    let loadedFor = null; // uuid the current fetch belongs to; null = dialog closed
    const friendUuid = () => new URLSearchParams(location.search).get('avec');
    const cardId = (tile) => Number(tile.querySelector('img')?.getAttribute('src')?.match(/(\d+)\.webp/)?.[1]);
    const onMyTab = () =>
      /^\s*Mes cartes/.test(document.querySelector(`${ROOT} [role="tab"][aria-selected="true"]`)?.textContent || '');

    async function loadFriend(uuid) {
      try {
        const res = await api(`/api/trades/available/${uuid}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const list = await res.json();
        if (loadedFor === uuid) friendIds = new Set(list.map((c) => Number(c.characterId)));
      } catch (err) {
        console.warn('[kyara-mod] friend cards fetch failed', err);
      }
    }

    // Dialog just opened (root appeared) or friend changed: fetch their list.
    function watchDialog() {
      const uuid = document.querySelector(ROOT) ? friendUuid() : null;
      if (uuid === loadedFor) return;
      loadedFor = uuid;
      friendIds = null;
      if (uuid) loadFriend(uuid);
    }

    // `mine` filters only apply (and show) on the "Mes cartes" tab.
    const FILTERS = [
      { key: 'dbl', label: 'Doubles ×2+', active: false, keep: (t) => qty(t) >= 2 },
      {
        key: 'lack',
        label: 'Il lui manque',
        mine: true,
        active: false,
        keep: (t) => !friendIds || !friendIds.has(cardId(t)), // not loaded -> keep all
      },
    ];

    function ensureStyle() {
      if (document.getElementById('kmod-style-tf')) return;
      const style = document.createElement('style');
      style.id = 'kmod-style-tf';
      style.textContent = `${ROOT} .grid .${HIDE_CLASS}{display:none!important}`;
      document.head.append(style);
    }

    // Clone a site toggle ("Échangeables" or a chip) so ours get the same look.
    function ensureButtons() {
      const filters = document.querySelector(`${ROOT} .filters`);
      if (!filters || filters.querySelector(`[${BTN_ATTR}]`)) return;
      const chips = filters.querySelector('.chips');
      const siteToggle =
        filters.querySelector(`button.toggle:not([${BTN_ATTR}])`) ||
        chips?.querySelector(`button.only:not([${BTN_ATTR}])`);
      let anchor = filters.querySelector(`button.toggle:not([${BTN_ATTR}])`);
      for (const f of FILTERS) {
        const btn = siteToggle ? siteToggle.cloneNode(false) : document.createElement('button');
        btn.type = 'button';
        btn.setAttribute(BTN_ATTR, f.key);
        btn.textContent = f.label;
        btn.setAttribute('aria-pressed', String(f.active));
        btn.classList.toggle('on', f.active);
        btn.addEventListener('click', () => {
          f.active = !f.active;
          btn.setAttribute('aria-pressed', String(f.active));
          btn.classList.toggle('on', f.active);
          apply();
        });
        if (anchor) anchor.after(btn);
        else if (chips) chips.append(btn);
        else filters.append(btn);
        anchor = btn;
      }
    }

    function apply() {
      const mine = onMyTab();
      for (const b of document.querySelectorAll(`[${BTN_ATTR}="lack"]`)) b.hidden = !mine;
      const on = FILTERS.filter((f) => f.active && (!f.mine || mine));
      for (const tile of document.querySelectorAll(`${ROOT} .grid .tile`)) {
        // New markup wraps each tile in an <li> grid cell: hide that, or a gap remains.
        const cell = tile.closest(`${ROOT} .grid > li`) || tile;
        cell.classList.toggle(HIDE_CLASS, on.some((f) => !f.keep(tile)));
      }
    }

    return {
      id: 'tradeUtils',
      label: 'trade friend',
      start: ensureStyle,
      tick() {
        watchDialog();
        ensureButtons();
        apply(); // re-run: Svelte swaps tiles on tab change / search
      },
      stop() {
        loadedFor = friendIds = null;
        document.querySelectorAll(`[${BTN_ATTR}]`).forEach((b) => b.remove());
        document.querySelectorAll(`.${HIDE_CLASS}`).forEach((t) => t.classList.remove(HIDE_CLASS));
        document.getElementById('kmod-style-tf')?.remove();
      },
    };
  })();

  // --- Feature: rarity frame on trade board cards ----------------------------

  const boardFrames = (() => {
    const ATTR = 'data-kmod-frame';
    const SEL = 'ul.offers a.big > img, ul.offers a.thumb > img';

    // The site paints the rarity as an inset box-shadow on the <img>, which the
    // image itself covers. Reuse that colour as a padded background on the link.
    // Site dims unowned thumbs with opacity (our frame would bleed through) and
    // outlines owned ones on the <img> (drawn over our frame). Swap to a
    // brightness dim and move the outline onto the framed link.
    function ensureStyle() {
      if (document.getElementById('kmod-style-frame')) return;
      const style = document.createElement('style');
      style.id = 'kmod-style-frame';
      style.textContent =
        `ul.offers a[${ATTR}] > img{opacity:1!important;outline:none!important}` +
        `ul.offers a.thumb[${ATTR}]:not(.have) > img{filter:brightness(.5)}` +
        `ul.offers a.thumb.have[${ATTR}]{outline:2px solid var(--U);outline-offset:1px}`;
      document.head.append(style);
    }

    function decorate(img) {
      const color = img.style.boxShadow.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}/i)?.[0];
      if (!color) return;
      const a = img.parentElement;
      const radius = parseFloat(getComputedStyle(img).borderRadius) || 0;
      a.setAttribute(ATTR, '1');
      a.style.background = color;
      a.style.padding = '3px';
      a.style.borderRadius = `${radius + 3}px`;
      a.style.display = 'block';
      img.setAttribute(ATTR, img.style.boxShadow);
    }

    return {
      id: 'boardFrames',
      label: 'couleurs rareté (échanges)',
      start: ensureStyle,
      tick() {
        for (const img of document.querySelectorAll(SEL)) {
          // Svelte may reuse an <img> for another card: redo when the shadow changes.
          if (img.getAttribute(ATTR) !== img.style.boxShadow) decorate(img);
        }
      },
      stop() {
        document.getElementById('kmod-style-frame')?.remove();
        for (const el of document.querySelectorAll(`[${ATTR}]`)) {
          el.removeAttribute(ATTR);
          if (el.tagName === 'A') {
            el.style.background = el.style.padding = el.style.borderRadius = el.style.display = '';
          }
        }
      },
    };
  })();

  // --- Feature: owned qty on trade board + "doubles to give" filter --------

  const boardQty = (() => {
    const BADGE_ATTR = 'data-kmod-qty';
    const BTN_ATTR = 'data-kmod-bq';
    const HIDE_CLASS = 'kmod-hide-offer';
    const REFRESH_TICKS = 60; // re-fetch the collection about once a minute
    let qtys = null; // Map characterId -> qty; null until loaded
    let ticks = 0;
    let generation = 0;
    // Pills: keep offers whose requested card we own at least `min` times.
    // `active` is remembered until page reload; the highest active `min` wins.
    const PILLS = [
      { min: 2, label: 'Doubles à donner', title: 'Masquer les offres où tu n’as aucune carte demandée en ×2 ou plus', active: false },
      { min: 3, label: 'Triples à donner', title: 'Masquer les offres où tu n’as aucune carte demandée en ×3 ou plus', active: false },
    ];

    async function load() {
      const gen = generation;
      try {
        const res = await api('/api/me/collection?lean=1');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        // Expect an array; tolerate it being wrapped in an object.
        const list = Array.isArray(data) ? data : Object.values(data).find(Array.isArray) || [];
        if (gen === generation) qtys = new Map(list.map((c) => [Number(c.characterId), c.qty || 0]));
      } catch (err) {
        console.warn('[kyara-mod] collection fetch failed', err);
      }
    }

    const qtyOf = (a) => qtys.get(Number((a.getAttribute('href') || '').match(/\/wiki\/(\d+)/)?.[1])) || 0;

    function ensureStyle() {
      if (document.getElementById('kmod-style-bq')) return;
      const style = document.createElement('style');
      style.id = 'kmod-style-bq';
      style.textContent =
        `ul.offers li.offer.${HIDE_CLASS}{display:none!important}` +
        `ul.offers a.thumb{position:relative}` +
        `ul.offers [${BADGE_ATTR}]{position:absolute;top:-6px;right:-6px;z-index:1;` +
        `font-family:var(--mono);font-size:10px;line-height:1;padding:2px 5px;` +
        `border-radius:999px;background:var(--fg);color:var(--bg);pointer-events:none}`;
      document.head.append(style);
    }

    function ensureButton() {
      const filters = document.querySelector('section.board .filters');
      if (!filters || filters.querySelector(`[${BTN_ATTR}]`)) return;
      const sitePill = filters.querySelector(`button.pill:not([${BTN_ATTR}])`);
      for (const p of PILLS) {
        const btn = sitePill ? sitePill.cloneNode(false) : document.createElement('button');
        btn.type = 'button';
        btn.setAttribute(BTN_ATTR, String(p.min));
        btn.textContent = p.label;
        btn.title = p.title;
        btn.setAttribute('aria-pressed', String(p.active));
        btn.classList.toggle('on', p.active);
        btn.addEventListener('click', () => {
          p.active = !p.active;
          btn.setAttribute('aria-pressed', String(p.active));
          btn.classList.toggle('on', p.active);
          apply();
        });
        filters.append(btn);
      }
    }

    function apply() {
      for (const a of document.querySelectorAll('ul.offers a.thumb')) {
        const n = qtyOf(a);
        let badge = a.querySelector(`[${BADGE_ATTR}]`);
        if (!n) {
          badge?.remove();
          continue;
        }
        if (!badge) {
          badge = document.createElement('span');
          badge.setAttribute(BADGE_ATTR, '1');
          a.append(badge);
        }
        if (badge.textContent !== `×${n}`) badge.textContent = `×${n}`;
      }
      const min = Math.max(0, ...PILLS.filter((p) => p.active).map((p) => p.min));
      for (const li of document.querySelectorAll('ul.offers li.offer')) {
        const hide = min > 0 && ![...li.querySelectorAll('a.thumb')].some((a) => qtyOf(a) >= min);
        li.classList.toggle(HIDE_CLASS, hide);
      }
    }

    return {
      id: 'boardQty',
      label: 'quantités (échanges)',
      start() {
        ensureStyle();
        ticks = 0;
        load();
      },
      tick() {
        if (++ticks % REFRESH_TICKS === 0) load(); // pick up trades / boosters
        if (!qtys) return;
        ensureButton();
        apply(); // re-run: Svelte re-renders offers on search / filter
      },
      stop() {
        generation++;
        qtys = null;
        document.querySelectorAll(`[${BADGE_ATTR}], [${BTN_ATTR}]`).forEach((el) => el.remove());
        document.querySelectorAll(`.${HIDE_CLASS}`).forEach((el) => el.classList.remove(HIDE_CLASS));
        document.getElementById('kmod-style-bq')?.remove();
      },
    };
  })();

  // --- Album completion part: filters, auto-load, "Plus proches" sort ------

  const albumsHide = (() => {
    const BTN_ATTR = 'data-kmod-ah';
    const SORT_ATTR = 'data-kmod-as';
    const HIDE_CLASS = 'kmod-hide-album';
    const MIN_VISIBLE = 60; // the site's page size
    const MIN_SIZE = 5;
    let filling = false;

    let closest = false; // "Plus proches" sort, remembered until page reload

    // "X/Y · N %" meta line -> { owned: X, size: Y }
    function counts(li) {
      const m = (li.querySelector('.a-meta')?.textContent || '').match(/(\d+)\s*\/\s*(\d+)/);
      return m ? { owned: Number(m[1]), size: Number(m[2]) } : { owned: 0, size: 0 };
    }
    const size = (li) => counts(li).size;

    // Fewest missing first, completed albums last; ties: smaller album, then name.
    function sortKey(li) {
      const { owned, size } = counts(li);
      const missing = size - owned;
      return [missing === 0 ? Infinity : missing, size, li.querySelector('.a-name')?.textContent || ''];
    }
    function compare(a, b) {
      return a[0] - b[0] || a[1] - b[1] || a[2].localeCompare(b[2]);
    }

    // ul.albums is a CSS grid: reorder with `order` instead of moving nodes,
    // so Svelte's own re-renders can't put them back.
    function sortAlbums() {
      [...document.querySelectorAll('ul.albums > li')]
        .map((li) => ({ li, key: sortKey(li) }))
        .sort((a, b) => compare(a.key, b.key))
        .forEach(({ li }, i) => {
          if (li.style.order !== String(i)) li.style.order = String(i);
        });
    }

    function unsortAlbums() {
      document.querySelectorAll('ul.albums > li').forEach((li) => (li.style.order = ''));
    }

    // Our button sits in the site's "Trier" group; un-press the site's while ours is on.
    const siteSortButtons = () =>
      document.querySelectorAll(`.al-tools .views button:not([${SORT_ATTR}]):not([${BTN_ATTR}] button)`);

    function ensureSortButton() {
      const group = [...document.querySelectorAll('.al-tools .views')].find((g) => !g.hasAttribute(BTN_ATTR));
      if (!group || group.querySelector(`[${SORT_ATTR}]`)) return;
      const siteBtn = group.querySelector('button');
      const btn = siteBtn ? siteBtn.cloneNode(false) : document.createElement('button');
      btn.type = 'button';
      btn.setAttribute(SORT_ATTR, '1');
      btn.textContent = 'Plus proches';
      btn.title = 'Trier par cartes manquantes (charge tous les albums)';
      btn.setAttribute('aria-pressed', String(closest));
      btn.addEventListener('click', () => {
        if (closest) return;
        closest = true;
        btn.setAttribute('aria-pressed', 'true');
        siteSortButtons().forEach((b) => b.setAttribute('aria-pressed', 'false'));
        sortAlbums();
        fill();
      });
      group.append(btn);
    }

    // keep(li) -> false hides it. `active` is remembered until page reload.
    const FILTERS = [
      { key: 'done', label: 'Masquer complets', active: false, keep: (li) => !li.querySelector('.album .done') },
      { key: 'small', label: `Masquer < ${MIN_SIZE} cartes`, active: false, keep: (li) => size(li) >= MIN_SIZE },
    ];
    const anyActive = () => FILTERS.some((f) => f.active);

    function ensureStyle() {
      if (document.getElementById('kmod-style-ah')) return;
      const style = document.createElement('style');
      style.id = 'kmod-style-ah';
      style.textContent = `ul.albums > li.${HIDE_CLASS}{display:none!important}`;
      document.head.append(style);
    }

    // Clone the site's sort group so the toggles get the same look.
    function ensureButton() {
      const tools = document.querySelector('.al-tools');
      if (!tools || tools.querySelector(`[${BTN_ATTR}]`)) return;
      const siteGroup = tools.querySelector('.views');
      const group = siteGroup ? siteGroup.cloneNode(false) : document.createElement('div');
      group.setAttribute(BTN_ATTR, '1');
      group.removeAttribute('aria-label');
      const siteBtn = siteGroup?.querySelector('button');
      for (const f of FILTERS) {
        const btn = siteBtn ? siteBtn.cloneNode(false) : document.createElement('button');
        btn.type = 'button';
        btn.textContent = f.label;
        btn.setAttribute('aria-pressed', String(f.active));
        btn.addEventListener('click', () => {
          f.active = !f.active;
          btn.setAttribute('aria-pressed', String(f.active));
          apply();
          fill();
        });
        group.append(btn);
      }
      tools.append(group);
    }

    function apply() {
      const on = FILTERS.filter((f) => f.active);
      for (const li of document.querySelectorAll('ul.albums > li')) {
        li.classList.toggle(HIDE_CLASS, on.some((f) => !f.keep(li)));
      }
    }

    const countAlbums = () => document.querySelectorAll('ul.albums > li').length;
    const countVisible = () => document.querySelectorAll(`ul.albums > li:not(.${HIDE_CLASS})`).length;
    const moreButton = () => document.querySelector('ul.albums ~ .more button');

    // Hidden albums leave the page short, and the site only loads more on click:
    // keep clicking "Afficher plus" until a page's worth is visible again.
    // Sorting needs every album in the DOM, so then load them all.
    const wantMore = () => closest || (anyActive() && countVisible() < MIN_VISIBLE);

    async function fill() {
      if (filling) return;
      filling = true;
      try {
        let btn;
        while (wantMore() && (btn = moreButton())) {
          const before = countAlbums();
          btn.click();
          let grew = false;
          for (let t = 0; t < 5000 && !grew; t += 100) {
            await sleep(100);
            grew = countAlbums() > before;
          }
          if (!grew) break; // nothing came, stop
          apply();
          await sleep(300); // be gentle: each batch pulls in new cover images
        }
      } finally {
        filling = false;
        if (closest) sortAlbums();
      }
    }

    // Picking one of the site's sorts turns ours off. Svelte only re-sets
    // aria-pressed when its sort changes, so press the clicked one ourselves.
    function onDocumentClick(e) {
      const btn = e.target.closest?.('.al-tools .views button');
      if (!btn || !closest || btn.hasAttribute(SORT_ATTR) || btn.closest(`[${BTN_ATTR}]`)) return;
      closest = false;
      unsortAlbums();
      document.querySelector(`[${SORT_ATTR}]`)?.setAttribute('aria-pressed', 'false');
      btn.setAttribute('aria-pressed', 'true');
    }

    return {
      start() {
        ensureStyle();
        document.addEventListener('click', onDocumentClick, true);
      },
      tick() {
        ensureSortButton();
        ensureButton();
        apply(); // re-run: Svelte re-renders on sort / search
        if (wantMore()) fill(); // sort / search resets the list to one page
        if (closest) sortAlbums(); // also places newly loaded albums
      },
      stop() {
        closest = false;
        unsortAlbums();
        document.querySelector(`[${SORT_ATTR}]`)?.remove();
        document.removeEventListener('click', onDocumentClick, true);
        document.querySelectorAll(`[${BTN_ATTR}]`).forEach((el) => el.remove());
        document.querySelectorAll(`.${HIDE_CLASS}`).forEach((el) => el.classList.remove(HIDE_CLASS));
        document.getElementById('kmod-style-ah')?.remove();
      },
    };
  })();

  // --- Album completion part: middle / ctrl-click opens album in new tab --

  const albumLinks = (() => {
    // Albums are <button>s, but the collection page reads ?serie=<name> on load.
    const albumUrl = (album) => {
      const name = album.querySelector('.a-name')?.textContent.trim();
      return name ? `/collection?serie=${encodeURIComponent(name)}` : null;
    };
    const albumOf = (e) => e.target.closest?.('ul.albums button.album');

    function onMouseDown(e) {
      if (e.button === 1 && albumOf(e)) e.preventDefault(); // no autoscroll icon
    }

    function onAuxClick(e) {
      if (e.button !== 1) return;
      const url = albumOf(e) && albumUrl(albumOf(e));
      if (!url) return;
      e.preventDefault();
      window.open(url, '_blank', 'noopener');
    }

    function onClick(e) {
      if (!(e.ctrlKey || e.metaKey)) return;
      const url = albumOf(e) && albumUrl(albumOf(e));
      if (!url) return;
      e.preventDefault();
      e.stopImmediatePropagation(); // keep the site from also opening it here
      window.open(url, '_blank', 'noopener');
    }

    return {
      start() {
        document.addEventListener('mousedown', onMouseDown, true);
        document.addEventListener('auxclick', onAuxClick, true);
        document.addEventListener('click', onClick, true);
      },
      stop() {
        document.removeEventListener('mousedown', onMouseDown, true);
        document.removeEventListener('auxclick', onAuxClick, true);
        document.removeEventListener('click', onClick, true);
      },
    };
  })();

  // --- Feature: trade feed (auto-refresh offers by switching market tabs) --

  const boardRefresh = (() => {
    const BTN_ATTR = 'data-kmod-feed';
    const PERIOD = 30; // seconds between refreshes
    let on = false; // opt-in per visit, off after reload
    let elapsed = 0;
    let busy = false;
    let generation = 0;

    const tabs = () => [...document.querySelectorAll('[role="tablist"] button[role="tab"]')];
    const tab = (label) => tabs().find((b) => b.textContent.trim().startsWith(label));
    const onTrades = () => tab('Échanges')?.getAttribute('aria-selected') === 'true';

    async function waitFor(cond, ms = 3000) {
      for (let t = 0; t < ms; t += 100) {
        if (cond()) return true;
        await sleep(100);
      }
      return false;
    }

    function label(btn) {
      btn.textContent = on ? `Flux échanges ● ${PERIOD - elapsed}s` : 'Flux échanges';
      btn.setAttribute('aria-pressed', String(on));
      btn.classList.toggle('on', on);
    }

    function ensureButton() {
      const head = document.querySelector('section.head');
      if (!head || !/Le marché/.test(head.querySelector('h1')?.textContent || '')) return null;
      let btn = head.querySelector(`[${BTN_ATTR}="1"]`);
      if (btn) return btn;
      // btn-ghost text is near-invisible on this header: match the title color.
      const color = getComputedStyle(head.querySelector('h1')).color;
      const make = (value, title) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'btn btn-ghost btn-sm';
        b.setAttribute(BTN_ATTR, value);
        b.style.color = color;
        b.title = title;
        return b;
      };
      btn = make('1', 'Recharger les offres d’échange toutes les 30 secondes');
      btn.addEventListener('click', () => {
        on = !on;
        elapsed = 0;
        label(btn);
      });
      label(btn);
      const now = make('reload', 'Recharger les offres maintenant');
      now.textContent = '↻';
      now.addEventListener('click', () => {
        if (busy || !onTrades() || shouldWait()) return;
        elapsed = 0;
        label(btn);
        refresh();
      });
      head.append(btn, now);
      return btn;
    }

    // Leaving the trade tab would wipe what the user is doing: wait instead.
    const shouldWait = () =>
      document.hidden ||
      document.querySelector('.builder') ||
      document.activeElement?.matches('input, textarea');

    async function refresh() {
      busy = true;
      const gen = generation;
      const y = scrollY;
      const search = document.querySelector('section.board input[type="search"]')?.value || '';
      const pills = [...document.querySelectorAll('section.board .filters button.pill.on:not([data-kmod-bq])')]
        .map((b) => b.textContent.trim());
      try {
        tab('Enchères')?.click();
        if (!(await waitFor(() => !onTrades()))) return;
        tab('Échanges')?.click();
        await waitFor(() => onTrades() && document.querySelector('section.board .filters'));
        if (gen !== generation) return;
        // Put back search and filters if the site reset them.
        const input = document.querySelector('section.board input[type="search"]');
        if (input && input.value !== search) {
          input.value = search;
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
        for (const b of document.querySelectorAll('section.board .filters button.pill:not([data-kmod-bq])')) {
          if (pills.includes(b.textContent.trim()) && !b.classList.contains('on')) b.click();
        }
        await waitFor(() => document.querySelector('ul.offers li.offer'), 2000);
        scrollTo(0, y);
      } finally {
        busy = false;
      }
    }

    // The site re-fetches offers itself after "Donner …": restart the countdown.
    function onClick(e) {
      if (e.target.closest?.('button')?.textContent.trim().startsWith('Donner ')) elapsed = 0;
    }

    return {
      id: 'boardRefresh',
      label: 'flux échanges (marché)',
      start() {
        document.addEventListener('click', onClick, true);
      },
      tick() {
        const btn = ensureButton();
        if (!btn || !on || busy) return;
        if (onTrades() && elapsed < PERIOD) elapsed++;
        if (elapsed >= PERIOD && onTrades() && !shouldWait()) {
          elapsed = 0;
          refresh();
        }
        label(btn);
      },
      stop() {
        generation++;
        on = false;
        document.removeEventListener('click', onClick, true);
        document.querySelectorAll(`[${BTN_ATTR}]`).forEach((el) => el.remove());
      },
    };
  })();

  // --- Feature: album completion (filters + "Plus proches" sort + new-tab) --

  const albumCompletion = {
    id: 'albumCompletion',
    label: 'album completion',
    start() {
      albumsHide.start();
      albumLinks.start();
    },
    tick: () => albumsHide.tick(),
    stop() {
      albumsHide.stop();
      albumLinks.stop();
    },
  };

  // --- Feature groups: several features under one toggle -------------------

  function group(id, label, parts) {
    const each = (method) => {
      for (const f of parts) {
        try {
          f[method]?.();
        } catch (err) {
          console.error(`[kyara-mod] ${f.id}.${method} failed`, err);
        }
      }
    };
    return { id, label, start: () => each('start'), tick: () => each('tick'), stop: () => each('stop') };
  }

  const browsingUtils = group('browsingUtils', 'browsing utils', [bgFix, wishlist]);
  const tradeMarket = group('tradeMarket', 'trade market', [boardFrames, boardQty, boardRefresh]);

  // --- Feature registry & settings -----------------------------------------

  const FEATURES = [priceSort, browsingUtils, tradeUtils, tradeMarket, albumCompletion];
  const STORAGE_KEY = 'kmod:features';
  const running = new Set();

  function loadSettings() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {};
    } catch {
      return {}; // blocked or corrupt storage -> defaults
    }
  }

  function saveSettings(settings) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
    } catch (err) {
      console.warn('[kyara-mod] could not save settings', err);
    }
  }

  const isEnabled = (f) => loadSettings()[f.id] !== false; // on by default

  function safe(f, method) {
    try {
      f[method]?.();
    } catch (err) {
      console.error(`[kyara-mod] ${f.id}.${method} failed`, err);
    }
  }

  function setEnabled(f, on) {
    saveSettings({ ...loadSettings(), [f.id]: on });
    if (on && !running.has(f)) {
      running.add(f);
      safe(f, 'start');
      safe(f, 'tick');
    } else if (!on && running.has(f)) {
      running.delete(f);
      safe(f, 'stop');
    }
  }

  // --- Settings menu inside #profile-pop (re-added each time it opens) ------

  function ensureMenu() {
    const pop = document.getElementById('profile-pop');
    if (!pop || pop.querySelector('[data-kmod-menu]')) return;
    const box = document.createElement('div');
    box.dataset.kmodMenu = '1';
    box.style.cssText =
      'margin-top:8px;padding-top:8px;border-top:1px solid currentColor;' +
      'display:flex;flex-direction:column;gap:6px;font-size:14px;';
    const title = document.createElement('strong');
    title.textContent = 'Kyara Mod';
    box.append(title);
    for (const f of FEATURES) {
      const row = document.createElement('label');
      row.style.cssText = 'display:flex;gap:8px;align-items:center;cursor:pointer;';
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = isEnabled(f);
      cb.addEventListener('change', () => setEnabled(f, cb.checked));
      row.append(cb, document.createTextNode(f.label));
      box.append(row);
    }
    pop.append(box);
  }

  // --- Loader ---------------------------------------------------------------

  setInterval(() => {
    for (const f of FEATURES) {
      if (!isEnabled(f)) continue;
      if (!running.has(f)) {
        running.add(f);
        safe(f, 'start');
      }
      safe(f, 'tick');
    }
    ensureMenu();
  }, 1000);
})();
