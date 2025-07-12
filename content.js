// Global variables
let isActive = false;
let cardIssuer = 'none';
let customFee = 0;
let exchangeRates = {};
let originalPrices = new Map();

// These will be loaded from JSON files
let currencySymbols = {};
let cardFees = {};

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
  } catch (error) {
    console.error('Error loading data files:', error);
    return; // Stop initialization if data files fail to load
  }

  // Load settings from storage
  const data = await chrome.storage.sync.get(['isActive', 'cardIssuer', 'customFee']);
  isActive = data.isActive || false;
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

// Fetch latest exchange rates from an API
async function updateExchangeRates() {
  try {
    const response = await fetch('https://open.er-api.com/v6/latest/JPY');
    const data = await response.json();
    exchangeRates = data.rates;
    exchangeRates['JPY'] = 1;

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
  originalPrices.set(node, text);
  let newText = text;

  // Automatic detection for currency symbols
  for (const [symbol, code] of Object.entries(currencySymbols)) {
    const regex = new RegExp(`(?<=\\s|^)${symbol.replace('$', '\\$')}\\s*(\\d+(?:[.,]\\d+)?)`, 'g');
    newText = newText.replace(regex, (match, amount) => {
      const price = parseFloat(amount.replace(',', '.'));
      const yenPrice = convertToYen(price, code);
      return `${match} (¥${yenPrice})`;
    });
  }

  // And for currency codes (e.g., 10 USD)
  const codeRegex = /(\d+(?:[.,]\d+)?)\s*([A-Z]{3})/g;
  newText = newText.replace(codeRegex, (match, amount, code) => {
    if (exchangeRates[code]) {
      const price = parseFloat(amount.replace(',', '.'));
      const yenPrice = convertToYen(price, code);
      return `${match} (¥${yenPrice})`;
    }
    return match;
  });

  if (newText !== text) {
    node.textContent = newText;
  }
}

// Convert a given price to JPY based on currency code and fees
function convertToYen(price, currencyCode) {
  const rate = exchangeRates[currencyCode];
  if (!rate) return 'N/A';
  let yenPrice = price / rate;
  const feeRate = cardIssuer === 'custom' ? customFee : (cardFees[cardIssuer] || 0);
  if (feeRate > 0) {
    yenPrice *= (1 + feeRate / 100);
  }
  return Math.round(yenPrice).toLocaleString();
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
      if (isActive) convertPrices();
      else restoreOriginalPrices();
      break;
    case 'updateSettings':
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