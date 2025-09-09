// Global variables
let isActive = false;
let fromCurrency = 'auto';
let toCurrency = 'JPY'; // Add 'to' currency
let cardIssuer = 'none';
let customFee = 0;
let exchangeRates = {};
let originalPrices = new Map();

// These will be loaded from JSON files
let currencySymbols = {};
let cardFees = {};
let currencyCodeToSymbol = {}; // New reverse map for symbols

// To be built once after data is loaded
let allIdentifiersRegex;

// Initialize the extension
init();

// Initialization function
async function init() {
  // Fetch data files first
  try {
    const [symbolsResponse, feesResponse] = await Promise.all([
      fetch(chrome.runtime.getURL('currencySymbols.json')),
      fetch(chrome.runtime.getURL('cardFees.json'))
    ]);
    currencySymbols = await symbolsResponse.json();
    cardFees = await feesResponse.json();

    // Create a reverse map to get symbol from code
    currencyCodeToSymbol = Object.fromEntries(Object.entries(currencySymbols).map(([symbol, code]) => [code, symbol]));
    currencyCodeToSymbol['JPY'] = '¥'; // Ensure JPY is in the map

    buildAllIdentifiersRegex(); // Build the master regex
  } catch (error) {
    console.error('Error loading data files:', error);
    return; // Stop initialization if data files fail to load
  }

  // Load settings from storage
  const data = await chrome.storage.sync.get(['isActive', 'fromCurrency', 'toCurrency', 'cardIssuer', 'customFee']);
  isActive = data.isActive || false;
  fromCurrency = data.fromCurrency || 'auto';
  toCurrency = data.toCurrency || 'JPY'; // Load 'to' currency
  cardIssuer = data.cardIssuer || 'none';
  customFee = data.customFee || 0;

  // Fetch exchange rates
  await updateExchangeRates();

  // If active, start the conversion
  if (isActive) {
    convertPrices();
  }

  // Set up a MutationObserver to detect DOM changes
  setupMutationObserver();

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener(handleMessages);
}

// Build a single regex to find all known currency symbols and codes
function buildAllIdentifiersRegex() {
    const allSymbols = Object.keys(currencySymbols).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const allCodes = Object.values(currencySymbols);
    const allIdentifiers = [...allSymbols, ...allCodes, 'JPY']; // Add JPY
    const identifiersPart = allIdentifiers.join('|');
    const numberPart = `\\d+(?:[\\s.,]\\d+)*`; // Handles spaces and separators

    // Regex to find an identifier before or after a number
    allIdentifiersRegex = new RegExp(`(?:${identifiersPart})\\s*(${numberPart})|(${numberPart})\\s*(?:${identifiersPart})`, 'g');
}

// Fetch latest exchange rates from an API
async function updateExchangeRates() {
  try {
    // Fetch against USD
    const response = await fetch('https://open.er-api.com/v6/latest/USD');
    const data = await response.json();
    exchangeRates = data.rates;

    const timestamp = new Date().getTime();
    chrome.storage.local.set({ exchangeRates, rateTimestamp: timestamp });

  } catch (error)
 {
    console.error('Error fetching exchange rates:', error);
    const data = await chrome.storage.local.get(['exchangeRates', 'rateTimestamp']);
    if (data.exchangeRates) {
      exchangeRates = data.exchangeRates;
      console.log('Using cached exchange rates from:', new Date(data.rateTimestamp));
    }
  }
}

// Convert all prices on the page
function convertPrices() {
  const textNodes = findTextNodes(document.body);
  textNodes.forEach(node => processPriceNode(node));
}

// Recursively find all relevant text nodes
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

// Process a single text node for price conversion
function processPriceNode(node) {
  if (originalPrices.has(node) || !node.textContent.trim()) {
    return;
  }
  const text = node.textContent;
  let newText = text;
  
  const performConversion = (match, amount, fromCode) => {
    if (!amount || !fromCode) return match;
    
    // **FIXED LOGIC**: This now correctly removes all commas for thousands separators.
    const cleanAmount = amount.replace(/,/g, '');
    const price = parseFloat(cleanAmount);
    
    if (isNaN(price) || fromCode === toCurrency) return match; // Don't convert if it's already the target currency

    const convertedString = convertCurrency(price, fromCode);
    return `${match} (${convertedString})`;
  };

  if (fromCurrency !== 'auto') {
    // Manual override mode
    newText = text.replace(allIdentifiersRegex, (match, amount1, amount2) => {
      const amount = amount1 || amount2;
      return performConversion(match, amount, fromCurrency);
    });
  } else {
    // Auto-detect mode
    newText = text.replace(allIdentifiersRegex, (match, amount1, amount2) => {
      const amount = amount1 || amount2;
      const cleanMatch = match.toUpperCase();
      let detectedCode = null;

      // Find which code or symbol was in the match
      for (const [symbol, code] of Object.entries(currencySymbols)) {
          if (cleanMatch.includes(symbol)) {
              detectedCode = code;
              break;
          }
      }
      if (!detectedCode) {
          for (const code of Object.values(currencySymbols)) {
              if (cleanMatch.includes(code)) {
                  detectedCode = code;
                  break;
              }
          }
      }
       if (!detectedCode && cleanMatch.includes('JPY')) {
          detectedCode = 'JPY';
      }

      return detectedCode ? performConversion(match, amount, detectedCode) : match;
    });
  }

  if (newText !== text) {
    originalPrices.set(node, text);
    node.textContent = newText;
  }
}


// Convert a given price to the target currency
function convertCurrency(price, fromCode) {
  const fromRate = exchangeRates[fromCode]; // Rate vs USD
  const toRate = exchangeRates[toCurrency];   // Rate vs USD

  if (!fromRate || !toRate) return 'N/A';
  
  // Convert price to USD first, then to the target currency
  const priceInUSD = price / fromRate;
  let convertedPrice = priceInUSD * toRate;

  const feeRate = cardIssuer === 'custom' ? customFee : (cardFees[cardIssuer] || 0);
  if (feeRate > 0) {
    convertedPrice *= (1 + feeRate / 100);
  }

  const finalPrice = Math.round(convertedPrice).toLocaleString();
  const toSymbol = currencyCodeToSymbol[toCurrency] || toCurrency;

  return `${toSymbol}${finalPrice}`;
}

// Set up MutationObserver to handle dynamic content
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

// Handle messages from the popup script
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
      toCurrency = message.toCurrency; // Update 'to' currency
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

// Restore prices to their original state
function restoreOriginalPrices() {
  originalPrices.forEach((originalText, node) => {
    if (node.parentNode) {
      node.textContent = originalText;
    }
  });
  originalPrices.clear();
}