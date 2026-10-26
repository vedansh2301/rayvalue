import { describe, expect, it } from 'vitest';
import { integerWords, numberWords, speakable, yearWords } from './speech';

describe('integerWords / yearWords / numberWords', () => {
  it.each([
    [0, 'zero'],
    [7, 'seven'],
    [15, 'fifteen'],
    [40, 'forty'],
    [53, 'fifty-three'],
    [100, 'one hundred'],
    [905, 'nine hundred five'],
    [1000, 'one thousand'],
    [30900, 'thirty thousand nine hundred'],
    [53500, 'fifty-three thousand five hundred'],
    [1_250_000, 'one million two hundred fifty thousand'],
  ])('%i -> %s', (n, words) => expect(integerWords(n)).toBe(words));

  it('rejects what it cannot say', () => {
    expect(() => integerWords(-1)).toThrow();
    expect(() => integerWords(1.5)).toThrow();
  });

  it.each([
    [2026, 'twenty twenty-six'],
    [2000, 'two thousand'],
    [2005, 'two thousand five'],
    [1999, 'nineteen ninety-nine'],
    [1905, 'nineteen oh five'],
  ])('year %i -> %s', (y, words) => expect(yearWords(y)).toBe(words));

  it.each([
    ['10.5', 'ten and a half'],
    ['15.5', 'fifteen and a half'],
    ['12.4', 'twelve point four'],
    ['0.5', 'zero point five'],
    ['3.05', 'three point oh five'],
    ['30,900', 'thirty thousand nine hundred'],
  ])('%s -> %s', (text, words) => expect(numberWords(text)).toBe(words));
});

describe('speakable: the forms the Reel copy uses', () => {
  it.each([
    ['$30,900 to $53,500', 'thirty thousand nine hundred to fifty-three thousand five hundred dollars'],
    ['$12,300–$16,100', 'twelve thousand three hundred to sixteen thousand one hundred dollars'],
    ['$1,200', 'one thousand two hundred dollars'],
    ['$1', 'one dollar'],
    ['$0', 'zero dollars'],
    ['$0.32', 'thirty-two cents'],
    ['$4.50', 'four dollars and fifty cents'],
    ['10.5 to 15.5', 'ten and a half to fifteen and a half'],
    ['12 to 17 years', 'twelve to seventeen years'],
    ['12–17 years', 'twelve to seventeen years'],
    ['12.4 kilowatts', 'twelve point four kilowatts'],
    ['8.5 kW', 'eight and a half kilowatts'],
    ['900 kWh', 'nine hundred kilowatt hours'],
    ['30%', 'thirty percent'],
    ['rayvalue.com/calculator/florida', 'Ray Value dot com slash calculator slash Florida'],
    ['rayvalue.com/solar/california/sdge', 'Ray Value dot com slash solar slash California slash S D G and E'],
    ['rayvalue.com/solar/florida/duke-energy-florida', 'Ray Value dot com slash solar slash Florida slash duke energy florida'],
    ['rayvalue.com', 'Ray Value dot com'],
    ['PG&E', 'P G and E'],
    ['SDG&E', 'S D G and E'],
    ['SCE', 'S C E'],
    ['FPL', 'F P L'],
    ['TECO', 'Teeko'],
    ['NEM 3.0', 'N E M three'],
    ['installs in 2026', 'installs in twenty twenty-six'],
    ['more than 25 years', 'more than twenty-five years'],
  ])('%s -> %s', (text, said) => expect(speakable(text)).toBe(said));

  it('reads the copy agent’s lines in full', () => {
    expect(speakable('Payback on solar alone: FPL, 12 to 17 years; Duke Energy Florida, 10.5 to 15.5; and TECO, 10.5 to 15.')).toBe(
      'Payback on solar alone: F P L, twelve to seventeen years; Duke Energy Florida, ten and a half to fifteen and a half; and Teeko, ten and a half to fifteen.',
    );
    expect(speakable('A system for that bill runs about $30,900 to $53,500 installed, depending on the utility.')).toBe(
      'A system for that bill runs about thirty thousand nine hundred to fifty-three thousand five hundred dollars installed, depending on the utility.',
    );
    expect(speakable('Every home is different. Run your own numbers free at rayvalue.com/calculator/florida.')).toBe(
      'Every home is different. Run your own numbers free at Ray Value dot com slash calculator slash Florida.',
    );
    expect(speakable('A typical PG&E home needs about 12.4 kilowatts of solar: $30,900 to $53,500 installed.')).toBe(
      'A typical P G and E home needs about twelve point four kilowatts of solar: thirty thousand nine hundred to fifty-three thousand five hundred dollars installed.',
    );
  });

  it('turns em-dashes into a pause and straightens quotes', () => {
    expect(speakable('Thinking about solar with SDG&E? The federal tax credit is gone — here’s what it really costs now.')).toBe(
      'Thinking about solar with S D G and E? The federal tax credit is gone, here\'s what it really costs now.',
    );
    expect(speakable('Gone—for good')).toBe('Gone, for good');
    expect(speakable('The credit ended for 2026 installs, so that’s the full price.')).toBe("The credit ended for twenty twenty-six installs, so that's the full price.");
  });

  it('leaves plain words alone', () => {
    expect(speakable('Your number will differ: your bill, shade, roof direction and installer’s price all move it.')).toBe(
      "Your number will differ: your bill, shade, roof direction and installer's price all move it.",
    );
  });
});
