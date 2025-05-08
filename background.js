// Background script for the YenConverter extension

// Initialize default settings when extension is installed
chrome.runtime.onInstalled.addListener(function() {
    chrome.storage.sync.set({
      isActive: false,
      cardIssuer: 'none',
      customFee: 0
    }, function() {
      console.log('YenConverter initialized with default settings');
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
  
  // Fetch exchange rates
  async function fetchExchangeRates() {
    try {
      const response = await fetch('https://open.er-api.com/v6/latest/JPY');
      const data = await response.json();
      
      // Convert the rates to JPY base
      const exchangeRates = Object.keys(data.rates).reduce((acc, currency) => {
        // Invert the rate since we want JPY as base
        acc[currency] = 1 / data.rates[currency];
        return acc;
      }, {});
      
      // Save the exchange rates and timestamp
      const timestamp = new Date().getTime();
      chrome.storage.local.set({ 
        exchangeRates, 
        rateTimestamp: timestamp
      });
      
      console.log('Exchange rates updated at', new Date(timestamp).toLocaleString());
      
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