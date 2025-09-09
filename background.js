// Background script for the Universal Currency Converter extension

// Initialize default settings when extension is installed
chrome.runtime.onInstalled.addListener(function() {
    chrome.storage.sync.set({
      isActive: false,
      fromCurrency: 'auto',
      toCurrency: 'JPY', // Default conversion to JPY
      cardIssuer: 'none',
      customFee: 0
    }, function() {
      console.log('Universal Currency Converter initialized with default settings');
    });
    
    // Set up alarm to refresh exchange rates daily
    chrome.alarms.create('refreshRates', {
      periodInMinutes: 1440 // Once per day
    });
  });
  
  // Handle alarm to refresh exchange rates
  chrome.alarms.onAlarm.addListener(async function(alarm) {
    if (alarm.name === 'refreshRates') {
      await fetchExchangeRates();
    }
  });
  
  // Fetch exchange rates against USD
  async function fetchExchangeRates() {
    try {
      // Fetch rates with USD as the base currency for universal conversion
      const response = await fetch('https://open.er-api.com/v6/latest/USD');
      const data = await response.json();
      
      const exchangeRates = data.rates; // Rates are now relative to USD
      
      // Save the exchange rates and timestamp
      const timestamp = new Date().getTime();
      chrome.storage.local.set({ 
        exchangeRates, 
        rateTimestamp: timestamp
      });
      
      console.log('Exchange rates updated against USD at', new Date(timestamp).toLocaleString());
      
      // Notify any active tabs to refresh their rates
      chrome.tabs.query({}, function(tabs) {
        tabs.forEach(tab => {
          chrome.tabs.sendMessage(tab.id, { 
            action: 'refreshRates',
            exchangeRates: exchangeRates
          }).catch(() => {
            // Ignore errors for inactive tabs
          });
        });
      });
      
    } catch (error) {
      console.error('Error fetching exchange rates:', error);
    }
  }