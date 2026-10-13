import { describe, expect, it } from 'vitest';
import { findNumberSpans, normalizeNumberWords as n, toAsciiDigits, withNumberDigits } from '@/lib/guardrail/number-words';

describe('guardrail.md section 3 examples', () => {
  it.each([
    ['दो सौ चालीस', '240'],
    ['डेढ़ सौ', '150'],
    ['ढाई हज़ार', '2500'],
    ['2 सौ', '200'],
    ['2 सौ 40', '240'],
    ['सवा सौ', '125'],
    ['सवा दो', '2.25'],
    ['साढ़े तीन सौ', '350'],
    ['पौने दो सौ', '175'],
    ['पौने सौ', '75'],
    ['साढ़े तीन', '3.5'],
    ['डेढ़', '1.5'],
    ['ढाई', '2.5'],
    ['सवा लाख', '125000'],
    ['एक लाख पचास हज़ार', '150000'],
    ['दो करोड़', '20000000'],
    ['पाँच सौ', '500'],
    ['निन्यानवे', '99'],
    ['दो हज़ार पाँच सौ बीस', '2520'],
  ])('Hindi %s = %s', (words, digits) => {
    expect(n(words)).toBe(digits);
  });

  it.each([
    ['do sau chalees', '240'],
    ['dedh sau', '150'],
    ['dhai hazaar', '2500'],
    ['paanch sau', '500'],
    ['sava sau', '125'],
    ['saadhe teen sau', '350'],
    ['paune do sau', '175'],
    ['pachaas', '50'],
    ['sattar', '70'],
    ['assi', '80'],
    ['nabbe', '90'],
    ['bees', '20'],
    ['tees', '30'],
    ['ek lakh', '100000'],
    ['dedh lakh', '150000'],
    ['teen sau pachaas rupaye', '350 rupaye'],
    ['do rupaye', '2 rupaye'],
    ['ek sau bees', '120'],
    ['do hajar', '2000'],
  ])('Hinglish %s = %s', (words, digits) => {
    expect(n(words)).toBe(digits);
  });

  it.each([
    ['one', '1'],
    ['nine', '9'],
    ['ten', '10'],
    ['nineteen', '19'],
    ['twenty', '20'],
    ['twenty-one', '21'],
    ['ninety-nine', '99'],
    ['one hundred', '100'],
    ['a hundred', '100'],
    ['two hundred and forty', '240'],
    ['three hundred', '300'],
    ['one thousand', '1000'],
    ['a thousand', '1000'],
    ['two thousand five hundred', '2500'],
    ['twelve hundred', '1200'],
    ['five lakh', '500000'],
    ['two crore', '20000000'],
    ['three million', '3000000'],
    ['a dozen', '12'],
    ['two dozen', '24'],
    ['half a dozen', '6'],
    ['one fifty', '150'],
    ['two forty', '240'],
    ['one fifty five', '155'],
    ['One Hundred And Twenty', '120'],
  ])('English %s = %s', (words, digits) => {
    expect(n(words)).toBe(digits);
  });

  it('writes money in words as an amount with its currency', () => {
    expect(n('four pounds fifty')).toBe('£4.50');
    expect(n('for four pounds fifty only')).toBe('for £4.50 only');
    expect(n('three dollars five')).toBe('$3.05');
    expect(n('two euros and twenty cents')).toBe('€2.20');
    expect(n('4 pounds fifty')).toBe('£4.50');
    expect(n('five pounds')).toBe('5 pounds');
    expect(n('two hundred rupees')).toBe('200 rupees');
    expect(n('ten dirhams')).toBe('10 dirhams');
  });
});

describe('Spanish and French', () => {
  it.each([
    ['uno', '1'],
    ['cinco', '5'],
    ['quince', '15'],
    ['dieciséis', '16'],
    ['veinte', '20'],
    ['veintiuno', '21'],
    ['treinta y cinco', '35'],
    ['noventa y nueve', '99'],
    ['cien', '100'],
    ['ciento veinte', '120'],
    ['doscientos cincuenta', '250'],
    ['dos mil', '2000'],
    ['mil quinientos', '1500'],
    ['un millón', '1000000'],
    ['cuatro euros con cincuenta', '€4.50'],
    ['tres', '3'],
  ])('Spanish %s = %s', (words, digits) => {
    expect(n(words)).toBe(digits);
  });

  it.each([
    ['deux', '2'],
    ['sept', '7'],
    ['quinze', '15'],
    ['vingt', '20'],
    ['vingt et un', '21'],
    ['vingt-deux', '22'],
    ['trente-cinq', '35'],
    ['soixante-dix', '70'],
    ['soixante et onze', '71'],
    ['soixante-quinze', '75'],
    ['quatre-vingts', '80'],
    ['quatre-vingt-dix-sept', '97'],
    ['deux cents', '200'],
    ['trois cent cinquante', '350'],
    ['mille', '1000'],
    ['deux mille cinq cents', '2500'],
    ['quatre euros cinquante', '€4.50'],
  ])('French %s = %s', (words, digits) => {
    expect(n(words)).toBe(digits);
  });

  it('keeps ordinary words that look like numbers', () => {
    expect(n('Do you want one? Once upon a time, a teen did it')).toBe('Do you want 1? Once upon a time, a teen did it');
    expect(n('per cent, 5 cents')).toBe('per cent, 5 cents');
    expect(n('un café, une baguette')).toBe('un café, une baguette');
    expect(n('char the bread, das ist gut')).toBe('char the bread, das ist gut');
    expect(n('un euro')).toBe('1 euro');
    expect(n('teen rupaye')).toBe('3 rupaye');
    expect(n('हमें दो रुपये चाहिए')).toBe('हमें 2 रुपये चाहिए');
    expect(n('मुझे दो दो')).toBe('मुझे दो दो');
  });
});

describe('digits in other scripts', () => {
  it('converts Devanagari, Arabic-Indic and Persian digits', () => {
    expect(toAsciiDigits('₹२४०')).toBe('₹240');
    expect(toAsciiDigits('٤٫٥٠ د.إ')).toBe('4.50 د.إ');
    expect(toAsciiDigits('١٢٣٬٤٥٦')).toBe('123,456');
    expect(toAsciiDigits('۱۲۳')).toBe('123');
    expect(n('199 درهم')).toBe('199 درهم');
    expect(n('السعر ١٩٩ درهم')).toBe('السعر 199 درهم');
  });

  it('keeps the length, so positions stay valid', () => {
    const s = 'Price: ₹२४० or four pounds fifty';
    expect(toAsciiDigits(s)).toHaveLength(s.length);
  });

  it('reads a comma as a decimal mark only before one or two digits', () => {
    expect(n('4,50 €')).toBe('4.50 €');
    expect(n('1,200 and 3,50,000')).toBe('1,200 and 3,50,000');
  });
});

describe('withNumberDigits', () => {
  it('returns the text plus its digit forms', () => {
    const w = withNumberDigits('Loaf for four pounds fifty, or ₹२४०');
    expect(w).toContain('Loaf for four pounds fifty, or ₹२४०');
    expect(w).toContain('£4.50');
    expect(w).toContain('₹240');
  });
  it('adds both spellings of a decimal', () => {
    expect(withNumberDigits('£4.50')).toContain('4.5');
    expect(withNumberDigits('£4.5')).toContain('4.50');
  });
  it('returns the text unchanged when there is nothing to convert', () => {
    expect(withNumberDigits('fresh bread')).toBe('fresh bread');
  });
});

describe('findNumberSpans', () => {
  it('gives positions in the original text', () => {
    const text = 'Rye for four pounds fifty or 2 सौ';
    const spans = findNumberSpans(text);
    expect(spans.map((s) => [s.text, s.value])).toEqual([
      ['four pounds fifty', '4.50'],
      ['2 सौ', '200'],
    ]);
    expect(text.slice(spans[0].start, spans[0].end)).toBe('four pounds fifty');
    expect(spans[0].currency?.code).toBe('GBP');
  });
  it('marks single words so a lone "one" can be ignored', () => {
    const [s] = findNumberSpans('one of our loaves');
    expect(s).toMatchObject({ value: '1', words: true, single: true });
  });
});
