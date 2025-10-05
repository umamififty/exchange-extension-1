// Global variables
let isActive = false;
let fromCurrency = 'auto';
let toCurrency = 'JPY';
let cardIssuer = 'none';
let customFee = 0;
let exchangeRates = {};
let originalPrices = new Map();

// These will be loaded from JSON files
let currencySymbols = {};
let cardFees = {};
let currencyCodeToSymbol = {};

// To be built once after data is loaded
let allIdentifiersRegex;

// Initialize the extension
init();

// Initialization function
async function init() {
  try {
    const [symbolsResponse, feesResponse] = await Promise.all([
      fetch(chrome.runtime.getURL('currencySymbols.json')),
      fetch(chrome.runtime.getURL('cardFees.json'))
    ]);
    currencySymbols = await symbolsResponse.json();
    cardFees = await feesResponse.json();

    currencyCodeToSymbol = Object.fromEntries(Object.entries(currencySymbols).map(([symbol, code]) => [code, symbol]));
    currencyCodeToSymbol['JPY'] = '¥';

    buildAllIdentifiersRegex();
  } catch (error) {
    console.error('Error loading data files:', error);
    return;
  }

  const data = await chrome.storage.sync.get(['isActive', 'fromCurrency', 'toCurrency', 'cardIssuer', 'customFee']);
  isActive = data.isActive || false;
  fromCurrency = data.fromCurrency || 'auto';
  toCurrency = data.toCurrency || 'JPY';
  cardIssuer = data.cardIssuer || 'none';
  customFee = data.customFee || 0;

  await updateExchangeRates();

  if (isActive) {
    convertPrices();
  }

  setupMutationObserver();
  chrome.runtime.onMessage.addListener(handleMessages);
}

function buildAllIdentifiersRegex() {
    const allSymbols = Object.keys(currencySymbols).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const allCodes = Object.values(currencySymbols);
    const allIdentifiers = [...allSymbols, ...allCodes, 'JPY'];
    const identifiersPart = allIdentifiers.join('|');
    const numberPart = `\\d+(?:[\\s.,]\\d+)*`;

    allIdentifiersRegex = new RegExp(`(?:${identifiersPart})\\s*(${numberPart})|(${numberPart})\\s*(?:${identifiersPart})`, 'g');
}

async function updateExchangeRates() {
  try {
    const response = await fetch('https://open.er-api.com/v6/latest/USD');
    const data = await response.json();
    exchangeRates = data.rates;
    const timestamp = new Date().getTime();
    chrome.storage.local.set({ exchangeRates, rateTimestamp: timestamp });
  } catch (error) {
    console.error('Error fetching exchange rates:', error);
    const data = await chrome.storage.local.get(['exchangeRates', 'rateTimestamp']);
    if (data.exchangeRates) {
      exchangeRates = data.exchangeRates;
      console.log('Using cached exchange rates from:', new Date(data.rateTimestamp));
    }
  }
}

function convertPrices() {
  const textNodes = findTextNodes(document.body);
  textNodes.forEach(node => processPriceNode(node));
}

function findTextNodes(element) {
  const textNodes = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, {
    acceptNode: function(node) {
      if (node.parentElement && (node.parentElement.tagName === 'SCRIPT' || node.parentElement.tagName === 'STYLE')) {
        return NodeFilter.FILTER_REJECT;
      }
      if (/\d/.test(node.textContent)) {
        return NodeFilter.FILTER_ACCEPT;
      }
      return NodeFilter.FILTER_SKIP;
    }
  });
  let node;
  while (node = walker.nextNode()) {
    textNodes.push(node);
  }
  return textNodes;
}

async function processPriceNode(node) {
  if (originalPrices.has(node) || !node.textContent.trim()) {
    return;
  }
  const text = node.textContent;
  let newText = text;

  const performConversion = async (match, amount, fromCode) => {
    if (!amount || !fromCode) return match;
    const cleanAmount = amount.replace(/,/g, '');
    const price = parseFloat(cleanAmount);
    if (isNaN(price) || fromCode === toCurrency) return match;

    const convertedString = await convertCurrency(price, fromCode);
    return `${match} (${convertedString})`;
  };
  
  const replacements = [];
  const matches = Array.from(text.matchAll(allIdentifiersRegex));

  for (const matchData of matches) {
      const match = matchData[0];
      const amount = matchData[1] || matchData[2];
      let fromCode = null;

      if (fromCurrency !== 'auto') {
          fromCode = fromCurrency;
      } else {
          const cleanMatch = match.toUpperCase();
          for (const [symbol, code] of Object.entries(currencySymbols)) {
              if (cleanMatch.includes(symbol)) { fromCode = code; break; }
          }
          if (!fromCode) {
              for (const code of Object.values(currencySymbols)) {
                  if (cleanMatch.includes(code)) { fromCode = code; break; }
              }
          }
          if (!fromCode && cleanMatch.includes('JPY')) { fromCode = 'JPY'; }
      }

      if (fromCode) {
          const replacement = await performConversion(match, amount, fromCode);
          replacements.push({ original: match, new: replacement });
      }
  }

  // Apply all replacements at once to avoid issues with nested matches
  for(const rep of replacements){
      newText = newText.replace(rep.original, rep.new);
  }

  if (newText !== text) {
    originalPrices.set(node, text);
    node.textContent = newText;
  }
}

async function convertCurrency(price, fromCode) {
    const fromRate = exchangeRates[fromCode];
    const toRate = exchangeRates[toCurrency];

    if (!fromRate || !toRate) return 'N/A';

    const priceInUSD = price / fromRate;
    let convertedPrice = priceInUSD * toRate;

    if (cardIssuer && cardIssuer !== 'none') {
        if (!cardFees.DEFAULT) {
            const feesResponse = await fetch(chrome.runtime.getURL('cardFees.json'));
            cardFees = await feesResponse.json();
        }

        let feeRate = 0;
        const presets = (await chrome.storage.sync.get('feePresets')).feePresets || {};

        if (cardFees[toCurrency] && cardFees[toCurrency][cardIssuer]) {
            feeRate = cardFees[toCurrency][cardIssuer];
        } else if (cardFees.DEFAULT && cardFees.DEFAULT[cardIssuer]) {
            feeRate = cardFees.DEFAULT[cardIssuer];
        } else if (presets[cardIssuer]) {
            feeRate = presets[cardIssuer];
        }

        if (feeRate > 0) {
            convertedPrice *= (1 + feeRate / 100);
        }
    }

    const finalPrice = Math.round(convertedPrice).toLocaleString();
    const toSymbol = currencyCodeToSymbol[toCurrency] || toCurrency;

    return `${toSymbol}${finalPrice}`;
}

function setupMutationObserver() {
  const observer = new MutationObserver((mutations) => {
    if (isActive) {
      setTimeout(() => {
        mutations.forEach(mutation => {
          mutation.addedNodes.forEach(newNode => {
            if (newNode.nodeType === Node.ELEMENT_NODE) {
              const textNodes = findTextNodes(newNode);
              textNodes.forEach(node => processPriceNode(node));
            }
          });
        });
      }, 500);
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

function handleMessages(message, sender, sendResponse) {
  switch (message.action) {
    case 'toggleConversion':
      isActive = message.isActive;
      if (isActive) {
        convertPrices();
      } else {
        restoreOriginalPrices();
      }
      break;
    case 'updateSettings':
      fromCurrency = message.fromCurrency;
      toCurrency = message.toCurrency;
      cardIssuer = message.cardIssuer;
      customFee = message.customFee;
      if (isActive) {
        restoreOriginalPrices();
        convertPrices();
      }
      break;
  }
  sendResponse({ success: true });
  return true;
}

function restoreOriginalPrices() {
  originalPrices.forEach((originalText, node) => {
    if (node.parentNode) {
      node.textContent = originalText;
    }
  });
  originalPrices.clear();
}