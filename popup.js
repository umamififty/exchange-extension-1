document.addEventListener('DOMContentLoaded', () => {
    // DOM elements
    const fromCurrencySelect = document.getElementById('fromCurrency');
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
            "NOK": "no", "SEK": "se" // Added Norway and Sweden
        };
        const cc = currencyToCountryCode[countryCode];
        if (!cc) return '';
        const codePoints = cc.toUpperCase().split('').map(char => 127397 + char.charCodeAt());
        return String.fromCodePoint(...codePoints);
    }

    // Initialization
    async function init() {
        const jpyFlagUrl = chrome.runtime.getURL('flags/JPY.svg');
        try {
            const response = await fetch(jpyFlagUrl);
            if (response.ok) {
                tickerBaseValue.style.backgroundImage = `linear-gradient(to left, var(--surface-color) 0%, transparent 80%), url('${jpyFlagUrl}')`;
            }
        } catch (error) {
            console.warn('Could not load JPY.svg flag.');
        }

        await populateFromCurrencies();
        await populateCardIssuers();
        
        const data = await chrome.storage.sync.get(['isActive', 'fromCurrency', 'cardIssuer']);

        updateToggleState(data.isActive || false);
        fromCurrencySelect.value = data.fromCurrency || 'auto';
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
        const selectedCurrency = fromCurrencySelect.value;
        
        if (selectedCurrency === 'auto' || selectedCurrency === 'JPY') {
            tickerConvertedValue.textContent = '';
            tickerConvertedValue.style.backgroundImage = 'none';
            return;
        }
        
        const flagUrl = chrome.runtime.getURL(`flags/${selectedCurrency}.svg`);
        
        try {
            const response = await fetch(flagUrl);
            if (response.ok) {
                tickerConvertedValue.style.backgroundImage = `linear-gradient(to right, var(--surface-color) 0%, transparent 80%), url('${flagUrl}')`;
            } else {
                tickerConvertedValue.style.backgroundImage = 'none';
            }
        } catch (error) {
            console.warn(`Could not fetch flag for ${selectedCurrency}:`, error);
            tickerConvertedValue.style.backgroundImage = 'none';
        }

        tickerConvertedValue.textContent = '...';

        try {
            const { exchangeRates } = await chrome.storage.local.get('exchangeRates');
            if (exchangeRates && exchangeRates[selectedCurrency]) {
                const rate = exchangeRates[selectedCurrency];
                const convertedAmount = 100 * rate;
                const decimalPlaces = convertedAmount < 1 ? 4 : 2;
                tickerConvertedValue.textContent = `${convertedAmount.toFixed(decimalPlaces)} ${selectedCurrency}`;
            } else {
                 tickerConvertedValue.textContent = 'N/A';
            }
        } catch (error) {
            console.error('Could not get rates for ticker:', error);
            tickerConvertedValue.textContent = 'Error';
        }
    }

    // Data Loading and Population
    async function populateFromCurrencies() {
        try {
            const response = await fetch(chrome.runtime.getURL('currencySymbols.json'));
            const symbols = await response.json();
            fromCurrencySelect.innerHTML = '<option value="auto">Auto-detect</option>';

            for (const symbol in symbols) {
                const code = symbols[symbol];
                const flag = getFlagEmoji(code);

                const option = document.createElement('option');
                option.value = code;
                option.textContent = `${flag} ${code} (${symbol})`;
                fromCurrencySelect.appendChild(option);
            }
        } catch (error) {
            console.error('Error loading currency symbols:', error);
        }
    }

    async function populateCardIssuers() {
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