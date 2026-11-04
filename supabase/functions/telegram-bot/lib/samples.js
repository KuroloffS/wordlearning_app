// GENERATED from bot/src/samples.js by bot/scripts/build-edge.mjs — edit the source file, then run `npm run build:edge` in bot/.
// German ↔ Russian starter words: [German, Russian, German example, Russian example].
// Each user gets them with the language they learn as the "word" side.
export const SAMPLE_PAIRS = [
  ['das Haus', 'дом', 'Das Haus ist groß.', 'Дом большой.'],
  ['die Katze', 'кошка', 'Die Katze schläft.', 'Кошка спит.'],
  ['der Hund', 'собака', 'Der Hund bellt.', 'Собака лает.'],
  ['lernen', 'учить', 'Ich lerne Deutsch.', 'Я учу русский язык.'],
  ['sprechen', 'говорить', 'Sprechen Sie Deutsch?', 'Вы говорите по-русски?'],
  ['verstehen', 'понимать', 'Ich verstehe dich.', 'Я тебя понимаю.'],
  ['schnell', 'быстрый', 'Das Auto ist schnell.', 'Это быстрая машина.'],
  ['schön', 'красивый', 'Die Stadt ist schön.', 'Город очень красивый.'],
  ['das Wasser', 'вода', 'Ich trinke Wasser.', 'Я пью воду.'],
  ['die Arbeit', 'работа', 'Die Arbeit ist interessant.', 'Работа интересная.'],
  ['der Freund', 'друг', 'Er ist mein Freund.', 'Он мой друг.'],
  ['die Stadt', 'город', 'Berlin ist eine große Stadt.', 'Москва — большой город.'],
];

/** Sample cards for a user who learns German ('de') or Russian ('ru'). */
export function samplesFor(learn) {
  return SAMPLE_PAIRS.map(([de, ru, deExample, ruExample]) =>
    learn === 'ru' ? { word: ru, translation: de, example: ruExample } : { word: de, translation: ru, example: deExample },
  );
}
