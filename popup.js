document.addEventListener('DOMContentLoaded', function() {
    const cardIssuerSelect = document.getElementById('cardIssuer');
    const customFeeContainer = document.getElementById('customFeeContainer');
    const customFeeInput = document.getElementById('customFee');
    const toggleButton = document.getElementById('toggleConversion');
    const statusDiv = document.getElementById('status');
    
    // Load saved settings
    chrome.storage.sync.get(['cardIssuer', 'customFee', 'isActive'], function(data) {
      if (data.cardIssuer) {
        cardIssuerSelect.value = data.cardIssuer;
        
        if (data.cardIssuer === 'custom') {
          customFeeContainer.style.display = 'block';
          customFeeInput.value = data.customFee || 0;
        }
      }
      
      updateStatus(data.isActive);
    });
    
    // Card issuer selection change
    cardIssuerSelect.addEventListener('change', function() {
      const selectedIssuer = cardIssuerSelect.value;
      
      if (selectedIssuer === 'custom') {
        customFeeContainer.style.display = 'block';
      } else {
        customFeeContainer.style.display = 'none';
      }
      
      saveSettings();
    });
    
    // Custom fee input change
    customFeeInput.addEventListener('change', function() {
      saveSettings();
    });
    
    // Toggle button click
    toggleButton.addEventListener('click', function() {
      chrome.storage.sync.get(['isActive'], function(data) {
        const newState = !data.isActive;
        
        chrome.storage.sync.set({ isActive: newState }, function() {
          updateStatus(newState);
          
          // Send message to content script to update conversion
          chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
            chrome.tabs.sendMessage(tabs[0].id, { 
              action: 'toggleConversion',
              isActive: newState
            });
          });
        });
      });
    });
    
    function saveSettings() {
      const selectedIssuer = cardIssuerSelect.value;
      const customFee = selectedIssuer === 'custom' ? parseFloat(customFeeInput.value) : 0;
      
      chrome.storage.sync.set({
        cardIssuer: selectedIssuer,
        customFee: customFee
      }, function() {
        // Notify content script of the change
        chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
          chrome.tabs.sendMessage(tabs[0].id, { 
            action: 'updateSettings',
            cardIssuer: selectedIssuer,
            customFee: customFee
          });
        });
      });
    }
    
    function updateStatus(isActive) {
      if (isActive) {
        statusDiv.textContent = 'Conversion active';
        statusDiv.className = 'status active';
        toggleButton.textContent = 'Disable Conversion';
      } else {
        statusDiv.textContent = 'Conversion inactive';
        statusDiv.className = 'status inactive';
        toggleButton.textContent = 'Enable Conversion';
      }
    }
  });