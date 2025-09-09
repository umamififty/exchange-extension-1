document.addEventListener('DOMContentLoaded', () => {
    // DOM elements
    const fromCurrencySelect = document.getElementById('fromCurrency');
    const toCurrencySelect = document.getElementById('toCurrency');
    const cardIssuerSelect = document.getElementById('cardIssuer');
    const toggleButton = document.getElementById('toggleConversion');
    const exchangeRateTicker = document.getElementById('exchangeRateTicker');
    const tickerBaseValue = document.querySelector('.ticker-base');
    const tickerConvertedValue = document.querySelector('.ticker-converted');

    // Fee Management elements
    const feeManagementContainer = document.getElementById('feeManagementContainer');
    const presetsListDiv = document.getElementById('presetsList');
    const newFeeNameInput = document.getElementById('newFeeName');
    const newFeeValueInput = document.getElementById('newFeeValue');
    const addFeeButton = document.getElementById('addFeeButton');

    // Helper Functions
    function getFlagEmoji(countryCode) {
        const currencyToCountryCode = {
            "USD": "us", "EUR": "eu", "GBP": "gb", "CNY": "cn", "KRW": "kr", "CAD": "ca", 
            "AUD": "au", "HKD": "hk", "INR": "in", "SGD": "sg", "MYR": "my", "THB": "th", 
            "IDR": "id", "VND": "vn", "PHP": "ph", "TWD": "tw", "CHF": "ch", "NZD": "nz", 
            "BRL": "br", "RUB": "ru", "TRY": "tr", "ZAR": "za", "JPY": "jp",
            "NOK": "no", "SEK": "se"
        };
        const cc = currencyToCountryCode[countryCode];
        if (!cc) return '';
        const codePoints = cc.toUpperCase().split('').map(char => 127397 + char.charCodeAt());
        return String.fromCodePoint(...codePoints);
    }

    // Initialization
    async function init() {
        await Promise.all([
            populateCurrencies(fromCurrencySelect, 'from'),
            populateCurrencies(toCurrencySelect, 'to'),
            populateCardIssuers()
        ]);
        
        const data = await chrome.storage.sync.get(['isActive', 'fromCurrency', 'toCurrency', 'cardIssuer']);

        updateToggleState(data.isActive || false);
        fromCurrencySelect.value = data.fromCurrency || 'auto';
        toCurrencySelect.value = data.toCurrency || 'JPY';
        cardIssuerSelect.value = data.cardIssuer || 'none';
        
        await updateTicker();
        toggleFeeManagementView();
    }

    // UI Update Functions
    function updateToggleState(isActive) {
        toggleButton.textContent = isActive ? 'Conversion Enabled' : 'Conversion Disabled';
        toggleButton.className = isActive ? 'enabled' : 'disabled';
    }

    async function toggleFeeManagementView() {
        if (cardIssuerSelect.value === 'manage_presets') {
            await renderPresetManagementList();
            feeManagementContainer.style.display = 'flex';
        } else {
            feeManagementContainer.style.display = 'none';
        }
    }
    
    async function updateTicker() {
        const fromCode = fromCurrencySelect.value;
        const toCode = toCurrencySelect.value;

        if (fromCode === 'auto' || fromCode === toCode) {
            exchangeRateTicker.style.display = 'none';
            return;
        }
        exchangeRateTicker.style.display = 'flex';

        // Set flags
        const fromFlagUrl = chrome.runtime.getURL(`flags/${fromCode}.svg`);
        const toFlagUrl = chrome.runtime.getURL(`flags/${toCode}.svg`);
        tickerBaseValue.style.backgroundImage = `linear-gradient(to left, var(--surface-color) 0%, transparent 80%), url('${fromFlagUrl}')`;
        tickerConvertedValue.style.backgroundImage = `linear-gradient(to right, var(--surface-color) 0%, transparent 80%), url('${toFlagUrl}')`;

        // Set text
        tickerBaseValue.textContent = `1 ${fromCode}`;
        tickerConvertedValue.textContent = '...';

        try {
            const { exchangeRates } = await chrome.storage.local.get('exchangeRates');
            if (exchangeRates && exchangeRates[fromCode] && exchangeRates[toCode]) {
                const fromRate = exchangeRates[fromCode]; // Rate vs USD
                const toRate = exchangeRates[toCode];     // Rate vs USD
                const conversionRate = toRate / fromRate;
                tickerConvertedValue.textContent = `${conversionRate.toFixed(4)} ${toCode}`;
            } else {
                tickerConvertedValue.textContent = 'N/A';
            }
        } catch (error) {
            console.error('Could not get rates for ticker:', error);
            tickerConvertedValue.textContent = 'Error';
        }
    }

    // Data Loading and Population
    async function populateCurrencies(selectElement, type) {
        try {
            const response = await fetch(chrome.runtime.getURL('currencySymbols.json'));
            const symbols = await response.json();
            
            if (type === 'from') {
                selectElement.innerHTML = '<option value="auto">Auto-detect</option>';
            } else {
                selectElement.innerHTML = '';
            }

            const currencies = { ...symbols, "¥": "JPY" }; // Add JPY to the list

            for (const symbol in currencies) {
                const code = currencies[symbol];
                const flag = getFlagEmoji(code);
                const option = document.createElement('option');
                option.value = code;
                option.textContent = `${code} (${symbol}) ${flag}`;
                selectElement.appendChild(option);
            }
        } catch (error) {
            console.error('Error loading currency symbols:', error);
        }
    }

    async function populateCardIssuers() {
        // ... (this function remains unchanged)
        try {
            const [feesResponse, presetsData] = await Promise.all([
                fetch(chrome.runtime.getURL('cardFees.json')),
                chrome.storage.sync.get('feePresets')
            ]);
            
            const baseFees = await feesResponse.json();
            const customPresets = presetsData.feePresets || {};
            
            cardIssuerSelect.innerHTML = '';

            for (const issuer in baseFees) {
                const option = document.createElement('option');
                option.value = issuer;
                let text = issuer.charAt(0).toUpperCase() + issuer.slice(1);
                if (baseFees[issuer] > 0) text += ` (${baseFees[issuer]}%)`;
                option.textContent = text;
                cardIssuerSelect.appendChild(option);
            }
            
            if (Object.keys(customPresets).length > 0) {
                const separator = document.createElement('option');
                separator.disabled = true;
                separator.textContent = '──────────';
                cardIssuerSelect.appendChild(separator);
                
                for (const name in customPresets) {
                    const option = document.createElement('option');
                    option.value = name;
                    option.textContent = `${name} (${customPresets[name]}%)`;
                    cardIssuerSelect.appendChild(option);
                }
            }

            const manageSeparator = document.createElement('option');
            manageSeparator.disabled = true;
            manageSeparator.textContent = '──────────';
            cardIssuerSelect.appendChild(manageSeparator);
            
            const manageOption = document.createElement('option');
            manageOption.value = 'manage_presets';
            manageOption.textContent = 'Manage Custom Presets...';
            cardIssuerSelect.appendChild(manageOption);

        } catch (error) {
            console.error('Error loading fees and presets:', error);
        }
    }

    // Settings and Communication
    function saveAndNotify() {
        const settings = {
            isActive: toggleButton.classList.contains('enabled'),
            fromCurrency: fromCurrencySelect.value,
            toCurrency: toCurrencySelect.value,
            cardIssuer: cardIssuerSelect.value,
        };
        chrome.storage.sync.set(settings);
        notifyContentScript('updateSettings', settings);
    }

    function notifyContentScript(action, data) {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs[0] && tabs[0].id) {
                chrome.tabs.sendMessage(tabs[0].id, { action, ...data }).catch(e => console.log("Error sending message:", e));
            }
        });
    }

    // Fee Preset Logic
    async function renderPresetManagementList() {
        // ... (this function remains unchanged)
        const { feePresets } = await chrome.storage.sync.get('feePresets');
        presetsListDiv.innerHTML = '';

        if (feePresets && Object.keys(feePresets).length > 0) {
            for (const name in feePresets) {
                const presetItem = document.createElement('div');
                presetItem.className = 'preset-item';
                
                const textSpan = document.createElement('span');
                textSpan.textContent = `${name} (${feePresets[name]}%)`;
                
                const deleteButton = document.createElement('button');
                deleteButton.className = 'delete-preset';
                deleteButton.textContent = 'X';
                deleteButton.onclick = () => deletePreset(name);
                
                presetItem.appendChild(textSpan);
                presetItem.appendChild(deleteButton);
                presetsListDiv.appendChild(presetItem);
            }
        } else {
            presetsListDiv.textContent = 'No custom presets saved.';
        }
    }
    
    async function addNewFee() {
        // ... (this function remains unchanged)
        const name = newFeeNameInput.value.trim();
        const value = parseFloat(newFeeValueInput.value);
        if (!name || isNaN(value)) {
            alert('Please enter a valid preset name and fee value.');
            return;
        }

        const { feePresets } = await chrome.storage.sync.get('feePresets');
        const presets = feePresets || {};
        presets[name] = value;
        
        await chrome.storage.sync.set({ feePresets: presets });
        
        newFeeNameInput.value = '';
        newFeeValueInput.value = '';
        
        await populateCardIssuers();
        cardIssuerSelect.value = name;
        await toggleFeeManagementView();
        saveAndNotify();
    }

    async function deletePreset(nameToDelete) {
        // ... (this function remains unchanged)
        const { feePresets } = await chrome.storage.sync.get('feePresets');
        if (feePresets && feePresets[nameToDelete]) {
            delete feePresets[nameToDelete];
            await chrome.storage.sync.set({ feePresets });
            
            await populateCardIssuers();
            cardIssuerSelect.value = 'none';
            await renderPresetManagementList();
            saveAndNotify();
        }
    }

    // Event Listeners
    toggleButton.addEventListener('click', () => {
        const isActive = !toggleButton.classList.contains('enabled');
        updateToggleState(isActive);
        notifyContentScript('toggleConversion', { isActive });
        saveAndNotify();
    });

    fromCurrencySelect.addEventListener('change', () => {
        updateTicker();
        saveAndNotify();
    });

    toCurrencySelect.addEventListener('change', () => {
        updateTicker();
        saveAndNotify();
    });

    cardIssuerSelect.addEventListener('change', () => {
        toggleFeeManagementView();
        if (cardIssuerSelect.value !== 'manage_presets') {
            saveAndNotify();
        }
    });

    addFeeButton.addEventListener('click', addNewFee);

    // Start the Popup
    init();
});