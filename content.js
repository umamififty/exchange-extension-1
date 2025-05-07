// Global variables
let isActive = false;
let cardIssuer = 'none';
let customFee = 0;
let exchangeRates = {};
let originalPrices = new Map();

// Currency symbols and codes
const currencySymbols = {
  '$': 'USD',
  '€': 'EUR',
  '£': 'GBP',
  '¥': 'CNY',
  '₩': 'KRW',
  'CA$': 'CAD',
  'A$': 'AUD',
  'HK$': 'HKD',
  '₹': 'INR'
};

// Card issuer fee rates
const cardFees = {
  'none': 0,
  'visa': 2.5,
  'mastercard': 2.7,
  'amex': 3.0,
  'jcb': 1.8,
  'rakuten': 2.0
};

// Initialize
init();

// Initialization function
async function init() {
  // Load settings
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

// Fetch latest exchange rates
async function updateExchangeRates() {
  try {
    // Using Exchange Rates API (you'll need to sign up for an API key)
    // For demo purposes, we're using a free endpoint with limited functionality
    const response = await fetch('https://open.er-api.com/v6/latest/JPY');
    const data = await response.json();
    
    // Convert the rates to JPY base (since the API gives USD base)
    exchangeRates = Object.keys(data.rates).reduce((acc, currency) => {
      // Invert the rate since we want JPY as base
      acc[currency] = 1 / data.rates[currency];
      return acc;
    }, {});
    
    // Save the timestamp for rate update
    const timestamp = new Date().getTime();
    chrome.storage.local.set({ exchangeRates, rateTimestamp: timestamp });
    
  } catch (error) {
    console.error('Error fetching exchange rates:', error);
    
    // Try to use cached rates
    const data = await chrome.storage.local.get(['exchangeRates', 'rateTimestamp']);
    if (data.exchangeRates) {
      exchangeRates = data.exchangeRates;
      console.log('Using cached exchange rates from:', new Date(data.rateTimestamp));
    }
  }
}

// Convert all prices on the page
function convertPrices() {
  // Find all text nodes that might contain prices
  const textNodes = findTextNodes(document.body);
  
  // Process each node for price conversion
  textNodes.forEach(node => {
    processPriceNode(node);
  });
}

// Find all text nodes in the document
function findTextNodes(element) {
  const textNodes = [];
  const walker = document.createTreeWalker(
    element,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode: function(node) {
        // Skip script and style elements
        if (node.parentElement && 
            (node.parentElement.tagName === 'SCRIPT' || 
             node.parentElement.tagName === 'STYLE')) {
          return NodeFilter.FILTER_REJECT;
        }
        // Accept nodes with potential price content
        const text = node.textContent.trim();
        if (text && /\d/.test(text) && 
            (new RegExp(Object.keys(currencySymbols).join('|')).test(text) || 
             /\d+\s*[A-Z]{3}/.test(text))) {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_SKIP;
      }
    }
  );
  
  let node;
  while(node = walker.nextNode()) {
    textNodes.push(node);
  }
  
  return textNodes;
}

// Process a text node for price conversion
function processPriceNode(node) {
  const text = node.textContent;
  
  // Skip if already processed
  if (originalPrices.has(node)) {
    return;
  }
  
  // Store original text
  originalPrices.set(node, text);
  
  // Find price patterns in the text
  let newText = text;
  
  // Match currency symbols followed by a number
  for (const [symbol, code] of Object.entries(currencySymbols)) {
    const regex = new RegExp(`${symbol}\\s*(\\d+(?:[.,]\\d+)?)`, 'g');
    newText = newText.replace(regex, (match, amount) => {
      const price = parseFloat(amount.replace(',', '.'));
      const yenPrice = convertToYen(price, code);
      return `${match} (¥${yenPrice})`;
    });
  }
  
  // Match numbers followed by currency codes (e.g., 10 USD)
  const codeRegex = /(\d+(?:[.,]\d+)?)\s*([A-Z]{3})/g;
  newText = newText.replace(codeRegex, (match, amount, code) => {
    if (exchangeRates[code]) {
      const price = parseFloat(amount.replace(',', '.'));
      const yenPrice = convertToYen(price, code);
      return `${match} (¥${yenPrice})`;
    }
    return match;
  });
  
  // Update text if changes were made
  if (newText !== text) {
    node.textContent = newText;
  }
}

// Convert a price to JPY
function convertToYen(price, currencyCode) {
  if (!exchangeRates[currencyCode]) {
    return 'N/A';
  }
  
  // Convert to JPY
  let yenPrice = price * exchangeRates[currencyCode];
  
  // Apply card fee if applicable
  const feeRate = cardIssuer === 'custom' ? customFee : cardFees[cardIssuer];
  if (feeRate > 0) {
    yenPrice = yenPrice * (1 + feeRate / 100);
  }
  
  // Format the JPY amount
  return Math.round(yenPrice).toLocaleString();
}

// Set up MutationObserver to detect DOM changes
function setupMutationObserver() {
  const observer = new MutationObserver((mutations) => {
    if (isActive) {
      // Process only if new nodes are added
      let hasNewNodes = false;
      mutations.forEach(mutation => {
        if (mutation.addedNodes.length > 0) {
          hasNewNodes = true;
        }
      });
      
      if (hasNewNodes) {
        // Delay conversion slightly to allow DOM to settle
        setTimeout(() => {
          convertPrices();
        }, 500);
      }
    }
  });
  
  // Start observing
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

// Handle messages from popup
function handleMessages(message, sender, sendResponse) {
  switch (message.action) {
    case 'toggleConversion':
      isActive = message.isActive;
      
      if (isActive) {
        convertPrices();
      } else {
        // Restore original prices
        restoreOriginalPrices();
      }
      break;
      
    case 'updateSettings':
      cardIssuer = message.cardIssuer;
      customFee = message.customFee;
      
      if (isActive) {
        // Refresh conversions with new settings
        restoreOriginalPrices();
        convertPrices();
      }
      break;
  }
  
  // Always send a response
  sendResponse({ success: true });
  return true; // Keep the message channel open for async response
}

// Restore original prices
function restoreOriginalPrices() {
  originalPrices.forEach((originalText, node) => {
    if (node.parentNode) {  // Check if node still exists in DOM
      node.textContent = originalText;
    }
  });
  
  // Clear the Map
  originalPrices.clear();
}