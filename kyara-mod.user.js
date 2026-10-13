// ==UserScript==
// @name         Kyara Mod
// @namespace    kyara-mod
// @version      0.5.0
// @description  UI tweaks for kyara.games, toggleable from the profile menu.
// @match        https://kyara.games/*
// @match        file:///*Kyara*
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // --- Shared helpers -------------------------------------------------------

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
      img.src = `/cards/lg/${id}.webp`;
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

  // --- Feature registry & settings -----------------------------------------

  const FEATURES = [priceSort, bgFix];
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
