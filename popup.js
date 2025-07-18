document.addEventListener('DOMContentLoaded', () => {
    // DOM elements
    const cardIssuerSelect = document.getElementById('cardIssuer');
    const customFeeContainer = document.getElementById('customFeeContainer');
    const customFeeInput = document.getElementById('customFee');
    const toggleButton = document.getElementById('toggleConversion');
    const statusDiv = document.getElementById('status');
    
    // Fee Preset elements
    const presetsListDiv = document.getElementById('feePresetsList');
    const newPresetNameInput = document.getElementById('newPresetName');
    const newPresetValueInput = document.getElementById('newPresetValue');
    const addPresetButton = document.getElementById('addPresetButton');

    // --- Initialization ---

    async function init() {
        await populateCardIssuers();
        await loadFeePresets();
        
        const data = await chrome.storage.sync.get(['isActive', 'cardIssuer', 'customFee']);
        
        // Set UI states from storage
        updateToggleState(data.isActive || false);
        cardIssuerSelect.value = data.cardIssuer || 'none';
        customFeeInput.value = data.customFee || 0;
        
        // Show/hide custom fee input based on selection
        toggleCustomFeeInput();
    }

    // --- UI Update Functions ---

    function updateToggleState(isActive) {
        if (isActive) {
            statusDiv.textContent = 'Conversion Active';
            statusDiv.className = 'status active';
            toggleButton.textContent = 'Disable Conversion';
        } else {
            statusDiv.textContent = 'Conversion Inactive';
            statusDiv.className = 'status inactive';
            toggleButton.textContent = 'Enable Conversion';
        }
    }

    function toggleCustomFeeInput() {
        if (cardIssuerSelect.value === 'custom') {
            customFeeContainer.style.display = 'block';
        } else {
            customFeeContainer.style.display = 'none';
        }
    }

    // --- Data Loading and Population ---

    async function populateCardIssuers() {
        try {
            const response = await fetch(chrome.runtime.getURL('cardFees.json'));
            const cardFees = await response.json();
            cardIssuerSelect.innerHTML = ''; // Clear existing options

            for (const issuer in cardFees) {
                const option = document.createElement('option');
                option.value = issuer;
                let text = issuer.charAt(0).toUpperCase() + issuer.slice(1);
                if (cardFees[issuer] > 0) {
                    text += ` (${cardFees[issuer]}%)`;
                }
                option.textContent = text;
                cardIssuerSelect.appendChild(option);
            }
            
            const customOption = document.createElement('option');
            customOption.value = 'custom';
            customOption.textContent = 'Custom Fee';
            cardIssuerSelect.appendChild(customOption);

        } catch (error) {
            console.error('Error loading card fees:', error);
        }
    }

    // --- Settings and Communication ---

    function saveSettings() {
        const isActive = statusDiv.classList.contains('active');
        const settings = {
            isActive: isActive,
            cardIssuer: cardIssuerSelect.value,
            customFee: parseFloat(customFeeInput.value) || 0
        };
        chrome.storage.sync.set(settings);
        return settings;
    }

    function notifyContentScript(action, data) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0] && tabs[0].id) {
                chrome.tabs.sendMessage(tabs[0].id, { action, ...data });
            }
        });
    }

    // --- Fee Preset Logic ---

    async function loadFeePresets() {
        const data = await chrome.storage.sync.get('feePresets');
        const presets = data.feePresets || {};
        presetsListDiv.innerHTML = ''; // Clear list
        
        for (const name in presets) {
            const presetValue = presets[name];
            const presetItem = document.createElement('div');
            presetItem.className = 'preset-item';
            presetItem.innerHTML = `<span>${name} (${presetValue}%)</span>`;
            
            const deleteButton = document.createElement('button');
            deleteButton.className = 'delete-preset';
            deleteButton.textContent = 'X';
            deleteButton.onclick = (e) => {
                e.stopPropagation(); // Prevent preset from being applied
                deletePreset(name);
            };
            
            presetItem.appendChild(deleteButton);
            presetItem.onclick = () => applyPreset(presetValue);
            presetsListDiv.appendChild(presetItem);
        }
    }

    async function addPreset() {
        const name = newPresetNameInput.value.trim();
        const value = parseFloat(newPresetValueInput.value);
        if (!name || isNaN(value)) {
            alert('Please enter a valid preset name and fee value.');
            return;
        }

        const data = await chrome.storage.sync.get('feePresets');
        const presets = data.feePresets || {};
        presets[name] = value;
        await chrome.storage.sync.set({ feePresets: presets });
        
        newPresetNameInput.value = '';
        newPresetValueInput.value = '';
        await loadFeePresets(); // Refresh the list
    }

    async function deletePreset(name) {
        const data = await chrome.storage.sync.get('feePresets');
        const presets = data.feePresets || {};
        delete presets[name];
        await chrome.storage.sync.set({ feePresets: presets });
        await loadFeePresets(); // Refresh the list
    }

    function applyPreset(value) {
        cardIssuerSelect.value = 'custom';
        customFeeInput.value = value;
        toggleCustomFeeInput();
        const settings = saveSettings();
        notifyContentScript('updateSettings', settings);
    }

    // --- Event Listeners ---

    toggleButton.addEventListener('click', () => {
        const wasActive = statusDiv.classList.contains('active');
        const isActive = !wasActive;
        updateToggleState(isActive);
        notifyContentScript('toggleConversion', { isActive });
        saveSettings();
    });

    cardIssuerSelect.addEventListener('change', () => {
        toggleCustomFeeInput();
        const settings = saveSettings();
        notifyContentScript('updateSettings', settings);
    });

    customFeeInput.addEventListener('input', () => {
        const settings = saveSettings();
        notifyContentScript('updateSettings', settings);
    });

    addPresetButton.addEventListener('click', addPreset);

    // --- Start the Popup ---
    init();
});