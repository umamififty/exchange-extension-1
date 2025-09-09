// --- Mock Data and Functions ---
const mockRates = { 'USD': 1, 'JPY': 150, 'EUR': 0.9, 'GBP': 0.8 };
const mockFees = { 'none': 0, 'Visa': 2.0 };
const currencySymbols = { "$": "USD", "€": "EUR", "£": "GBP", "¥": "JPY" };
const currencyCodeToSymbol = { "USD": "$", "EUR": "€", "GBP": "£", "JPY": "¥" };

/**
 * FIXED, ROBUST PARSER:
 * This function now correctly handles thousands separators by removing them.
 * This is the critical fix.
 */
function parseNumber(amountStr) {
    // A robust parser: remove all commas, then parse the float.
    // This correctly handles "1,000" and "1,000,000".
    const cleanAmount = amountStr.replace(/,/g, '');
    return parseFloat(cleanAmount);
}

/**
 * A simplified version of the main conversion logic.
 */
function convertCurrency(price, fromCode, toCode) {
  const fromRate = mockRates[fromCode];
  const toRate = mockRates[toCode];
  if (!fromRate || !toRate) return 'N/A';
  let convertedPrice = (price / fromRate) * toRate;
  const finalPrice = Math.round(convertedPrice).toLocaleString();
  const toSymbol = currencyCodeToSymbol[toCode] || toCode;
  return `${toSymbol}${finalPrice}`;
}


// --- Test Suite ---

describe('Currency Conversion Logic', () => {

  // SECTION 1: Testing the number parsing.
  describe('Number Parsing', () => {
    test('should parse a simple integer string', () => {
      expect(parseNumber("123")).toBe(123);
    });

    test('should parse a string with a decimal point', () => {
      expect(parseNumber("45.67")).toBe(45.67);
    });

    test('should correctly parse a number with a thousands separator', () => {
      expect(parseNumber("1,234")).toBe(1234);
    });

    test('should correctly parse a number with multiple thousands separators', () => {
      expect(parseNumber("1,000,000")).toBe(1000000);
    });
  });


  // SECTION 2: Testing the price detection regex.
  describe('Price String Detection and Replacement', () => {
    
    const processString = (text, toCurrency) => {
        const numberPart = `\\d+(?:[\\s.,]\\d+)*`;
        const allSymbols = Object.keys(currencySymbols).map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        const allCodes = Object.values(currencySymbols);
        const identifiersPart = [...allSymbols, ...allCodes].join('|');
        const regex = new RegExp(`(?:(${identifiersPart}))\\s*(${numberPart})|(${numberPart})\\s*(?:(${identifiersPart}))`, 'g');

        return text.replace(regex, (match, symbol1, amount1, amount2, symbol2) => {
            const amountStr = amount1 || amount2;
            const symbol = symbol1 || symbol2;
            const fromCode = currencySymbols[symbol] || symbol;

            if (fromCode === toCurrency) return match;

            const price = parseNumber(amountStr);
            const convertedString = convertCurrency(price, fromCode, toCurrency);
            return `${match} (${convertedString})`;
        });
    };

    test('should detect and convert price with currency symbol BEFORE the number', () => {
      const text = 'This item costs $10.';
      const expected = 'This item costs $10 (¥1,500).';
      expect(processString(text, 'JPY')).toBe(expected);
    });

    test('should detect and convert price with currency symbol AFTER the number', () => {
      const text = 'The total is 50.00 €';
      const expected = 'The total is 50.00 € ($56)'; 
      expect(processString(text, 'USD')).toBe(expected);
    });
    
    test('should handle numbers with commas', () => {
      const text = 'A big purchase of £1,000';
      // Now that parseNumber is fixed, this should pass.
      // (1000 / 0.8) = 1250
      const expected = 'A big purchase of £1,000 ($1,250)'; 
      expect(processString(text, 'USD')).toBe(expected);
    });

    test('should convert multiple different currencies in the same text', () => {
      const text = 'First item is $10, second is €20.';
      const expected = 'First item is $10 (¥1,500), second is €20 (¥3,333).';
      expect(processString(text, 'JPY')).toBe(expected);
    });

    test('should NOT convert prices that are already in the target currency', () => {
      const text = 'Price is ¥1,500 here and $10 elsewhere.';
      const expected = 'Price is ¥1,500 here and $10 (¥1,500) elsewhere.';
      expect(processString(text, 'JPY')).toBe(expected);
    });

    test('should correctly ignore numbers that are not prices', () => {
      const text = 'Order 54321 for item #88 costs $99.99 today.';
      const expected = 'Order 54321 for item #88 costs $99.99 (€90) today.';
      expect(processString(text, 'EUR')).toBe(expected);
    });
  });
});