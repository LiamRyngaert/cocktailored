// English -> Dutch word map for bar ingredient names. Ingredient names in the
// database are stored in English (legacy data), but the app is Dutch-only, so
// every place an ingredient name is shown to a user or sent to the cocktail
// generator translates it through this map first. Names are translated
// word-by-word (not as a fixed phrase list) so it also covers custom
// ingredients an admin adds later, as long as they use these common words.
// Words/brand names with no entry are left untouched.
const WORD_MAP: Record<string, string> = {
  vodka: "Wodka",
  rum: "Rum",
  gin: "Gin",
  tequila: "Tequila",
  whiskey: "Whisky",
  whisky: "Whisky",
  bourbon: "Bourbon",
  brandy: "Brandy",
  cognac: "Cognac",
  vermouth: "Vermout",
  champagne: "Champagne",
  prosecco: "Prosecco",
  wine: "Wijn",
  beer: "Bier",
  cider: "Cider",

  white: "Witte",
  dark: "Donkere",
  light: "Lichte",
  spiced: "Gekruide",
  aged: "Belegen",
  fresh: "Verse",
  sweet: "Zoete",
  sour: "Zure",
  dry: "Droge",
  sparkling: "Bruisende",
  coconut: "Kokos",

  lime: "Limoen",
  lemon: "Citroen",
  orange: "Sinaasappel",
  pineapple: "Ananas",
  cranberry: "Cranberry",
  grapefruit: "Grapefruit",
  apple: "Appel",
  peach: "Perzik",
  strawberry: "Aardbei",
  raspberry: "Framboos",
  blackberry: "Braam",
  blueberry: "Bosbes",
  grape: "Druiven",
  mango: "Mango",
  passionfruit: "Passievrucht",
  "passion": "Passievrucht",
  cherry: "Kers",
  watermelon: "Watermeloen",
  banana: "Banaan",
  kiwi: "Kiwi",

  juice: "Sap",
  syrup: "Siroop",
  water: "Water",
  soda: "Soda",
  tonic: "Tonic",
  cola: "Cola",
  ginger: "Gember",
  beer2: "Bier",

  simple: "Suiker",
  grenadine: "Grenadine",
  agave: "Agave",
  honey: "Honing",
  sugar: "Suiker",
  cane: "Riet",

  bitters: "Bitter",
  bitter: "Bitter",
  angostura: "Angostura",

  mint: "Munt",
  basil: "Basilicum",
  rosemary: "Rozemarijn",
  thyme: "Tijm",
  cucumber: "Komkommer",
  cinnamon: "Kaneel",
  vanilla: "Vanille",
  chili: "Chili",
  pepper: "Peper",
  chocolate: "Chocolade",
  cream: "Room",
  milk: "Melk",
  coffee: "Koffie",
  egg: "Ei",

  wedge: "Partje",
  slice: "Schijfje",
  peel: "Schil",
  zest: "Rasp",
  twist: "Twist",
  leaf: "Blaadje",
  leaves: "Blaadjes",
  garnish: "Garnering",

  triple: "Triple",
  sec: "Sec",
  kahlua: "Kahlua",
  amaretto: "Amaretto",
  campari: "Campari",
  aperol: "Aperol",
  elderflower: "Vlierbloesem",
};

export function translateIngredientName(name: string): string {
  return name
    .split(/(\s+)/)
    .map((token) => {
      const isWhitespace = /^\s+$/.test(token);
      if (isWhitespace) return token;
      const key = token.toLowerCase().replace(/[^a-z]/g, "");
      const translated = WORD_MAP[key];
      if (!translated) return token;
      // Preserve simple trailing punctuation from the original token.
      const suffix = token.slice(key.length);
      return translated + suffix;
    })
    .join("");
}
