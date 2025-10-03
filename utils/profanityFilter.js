// Profanity filter for comments
// Turkish and English bad words

const BANNED_WORDS = [
  // Türkçe küfürler
  'amk', 'aq', 'amq', 'amına', 'amina', 'amcık', 'amcik', 'sik', 'yarrak', 
  'taşak', 'tasak', 'göt', 'got', 'piç', 'pic', 'orospu', 'kahpe', 'pezevenk',
  'am', 'amguard', 'amcı', 'amci', 'bok', 'kaka', 'sıçmak', 'sicmak',
  'eşek', 'esek', 'mal', 'salak', 'aptal', 'gerizekalı', 'gerzek',
  'sikik', 'sikerim', 'siktir', 'yarak', 'yarrağım', 'yarragim',
  'götveren', 'götoş', 'götlek', 'gotlek', 'ibne', 'top', 'homo',
  
  // Eklenen Türkçe küfürler ve hakaretler (genişletilmiş ve temizlenmiş liste)
  'hıyar', 'it', 'hayvan', 'ezik', 'yavşak', 'dallama', 'pislik', 'lavuk', 'denyo',
  'deyyus', 'dümbük', 'dürzü', 'hödük', 'zibidi', 'kavat', 'gavat', 'alagavat', 'kaşar',
  'aşüfte', 'yosma', 'yelloz', 'şıllık', 'kevaşe', 'motor', 'sürtük', 'kaltak', 'fallik',
  'fahişe', 'puşt', 'ciğersiz', 'dalyarak', 'hasiktir', 'siki', 'tuttun', 'sikimde', 'değil',
  'ciğerini', 'dalağını', 'yordamını', 'sikko', 'sikindirik', 'sikimtırak', 'sikimtronik',
  'sikim', 'sokum', 'yarak', 'kürek', 'sikimsonik', 'amına', 'ibine', 'oç', 'amcık', 'ağızlı', 'koyayım', 'koyarım',
  'sik eyim', 'sikerim', 'hoşafı', 'götünden', 'kıç', 'lalesi', 'götübozuk', 'koyayım',
  'alırım', 'göte', 'geldin', 'ağzına', 'sıçayım', 'sıçarım', 'sıçtık', 'sıçışlardayız',
  'şarap', 'çanağına', 'camına', 'bacı', 'avrat', 'ecdad',
  'ced', 'sülale', 'eşekoğlu', 'eşşek', 'avradını', 'bacını', 'yedi', 'ceddini',
  'siktiğimin', 'oğlu', 'feriştahını', 'gelmişini', 'geçmişini', 'ebesini', 'göt', 'lalesi',
  'anasını', 'avradını', 'ağzını', 'yüzünü', 'pezevengi', 'boynuzlu', 'kerata',
  'sikişken', 'kancık', 'şırfıntı', 'pıttık', 'taşşak', 'büllük', 'çük', 'kutusunu',
  'rahminde', 'değmis', 'a.q', 'agazina', 'siciyim', 'agzina', 'isiyim', 'agzinin',
  'yayini', 'akilsiz', 'biti', 'amın', 'oğlu', 'götünden', 'sikerim', 'amcık',
  'ağızlı', 'yarragı', 'agizli', 'hosafi', 'sulfat', 'amin', 'ogl u', 'osurayım',
  'yumruk', 'attigim', 'amsalak', 'anam', 'avradım', 'anan', 'sicti',
  'essek', 'gotunden', 'sikiyim', 'sikerim', 'anin', 'ami', 'amin i',
  'anasınını', 'anasi', 'sikismis', 'angut', 'annenin', 'osurugunu', 'sikerim',
  'antenle', 'otuzbir', 'cekmek', 'ass', 'hole', 'tulip', 'yarragi', 'atyarragi', 'avradini',
  'sikiyim', 'ayioglu', 'çuk', 'kafalı', 'babanin', 'amina', 'koyum', 'bacinin',
  'amina', 'geciririm', 'beyinsiz', 'sikiyim', 'bok',
  'chukumu', 'yala', 'cibilliyetini', 'sikiyim',
  'cigerini', 'sikeyim', 'amı', 'daşak', 'dallama',
  'dalyarak', 'mezarda', 'sikiyim', 'deyus', 'daşağa', 'tasagi',
  'eşeğinin', 'siki', 'ebeni', 'sikerim', 'ebinin', 'ami', 'ecdadini', 'götünden', 'sikeyim', 'kafali',
  'orospu', 'cocugu', 'eshek', 'siken', 'fahise', 'feriştasını', 'sikeyim',
  'gavat', 'götübozuk', 'götümü', 'siker', 'sikicileri', 'cukume',
  'takil', 'gevsek', 'got', 'girs in', 'gotune', 'yayi', 'girs in',
  'girtlagini', 'sikeyim', 'got', 'siken',
  'got', 'ver en', 'gotcu', 'gotoglani', 'gotu', 'boklu', 'gotu', 'sikli', 'gotunu',
  'sikeyim', 'hiyaragasi', 'ibne', 'oğlu', 'ibne', 'ibnetor', 'siker', 'itoglu',
  'it', 'izdirabini', 'sikeyim', 'kabileni', 'sikerim', 'kafana', 'siciyim', 'kalantor',
  'kanini', 'sikiyim', 'katiksiz', 'orospu', 'cocugu', 'keriz', 'kicimi', 'sikeyim', 'kopek',
  'o.ç.', 'olusunu', 'siktigimin', 'evladi', 'orosp', 'oruspu', 'cucugu',
  'ossurturum', 'otuzbirci', 'pezevengin', 'cocugu', 'pezevengin',
  'pipi', 'sadrazam', 'canagina', 'sicayim', 'sikeyim',
  'sersem', 'sikin', 'mahsulü', 'sigir', 'siki', 'sik', 'kafalı', 'japon',
  'askeri', 'sik', 'kafali', 'sik', 'kili', 'sik', 'kirigi', 'sikem', 'chichen', 'chech',
  'siki', 'tutmuş', 'sikik', 'hayvan', 'sikik', 'orospu', 'cocugu', 'sikilik',
  'herif', 'sikilmis', 'eks isozluk', 'sikimde', 'sikimin', 'eşşeği',
  'sikimin', 'kurma', 'kolu', 'sikimin', 'sikkafa', 'sikko', 'sikli', 'sultan',
  'siksiz', 'siktir', 'sirfinti', 'agizli', 'ibne',
  'sulaleni', 'sikiyim', 'sutcunin', 'cocugu', 'surtuksun', 'kaltaksin',
  'tarladaki', 'bacini', 'sikeyim', 'tassakli', 'siksin', 'ebeni', 'terlikli',
  'orospunun', 'oglu', 'toynagini', 'sikeyim', 'travesti', 'tunek', 'tupcunun', 'cocugu',
  'bozi', 'yaragimin', 'basi', 'yarak', 'kafali', 'yarragimin', 'anteni',
  'yarrak', 'embesil', 'dangalak', 'öküz', 'sığır', 'manda', 'şırfıntı', 'otuz', 'birci',
  'ağzını', 'yüzünü', 'ul an', 'anasını', 'sikişken', 'kancık',
  'pıttık', 'taşşak', 'yarragi', 'değmis', 'orospu', 'cocugu', 'ayagindan', 'yarragı', 'avradini', 'sikiyim',
  'kafali', 'sikiyim', 'kafalı', 'sikiyim', 'kafali', 'sikiyim', 'kafali', 'sikiyim',
  'ibne', 'oğlu', 'ibne', 'ibnetor', 'siker', 'itoglu', 'it', 'izdirabini',
  'amına', 'sikeyim', 'kabileni', 'sikerim', 'kafana', 'siciyim', 'kalantor', 'kanini',
  'çakayım', 'kopek', 'beyinli', 'mal', 'degneyi', 'muslumanin',
  'o.ç.', 'olusunu', 'siktigimin', 'evladi', 'orosp', 'oruspu', 'cucugu',
  'ossurturum', 'otuzbirci', 'pezevengin', 'cocugu', 'pezevengin',
  'pipi', 'sadrazam', 'canagina', 'sicayim', 'sikeyim',
  'sersem', 'sikin', 'mahsulü', 'sigir', 'siki', 'sik', 'kafalı', 'japon',
  'orospi', 'irispi', 'mk', 'emuna', 'amina', 'eşeksiken', 'amdelen', 'döl', 'amınferyadı',
  'irispiçocu', 'oçcocu', 'oçoçuğu', 'orespi', 'ibiş', 'ipine', 'ib', 'orispi', 'orospe', 
  'orespu', 'erispi',

  // English swear words
  'pussy', 'dick', 'cock', 'fuck', 'shit', 'bitch', 'ass', 'asshole',
  'damn', 'hell', 'bastard', 'cunt', 'whore', 'slut', 'fag', 'nigger',
  
  // Eklenen English küfürler (genişletilmiş liste)
  'motherfucker', 'dickhead', 'dumbass', 'goddamn', 'goddamnit', 'jesus', 'christ', 'piss',
  'sonofabitch', 'prick', 'penis', 'pillock', 'frigging', 'bollocks', 'crap', 'slapper',
  'arse', 'dork', 'nonce', 'tits', 'moron', 'cretin', 'bell', 'bellend', 'berk', 'bint',
  'blimey', 'blighter', 'bloody', 'wanker', 'twat', 'knob', 'shag', 'bugger', 'sod', 'git',
  'minger', 'slag', 'tart', 'tosser', 'ponce', 'pikey', 'chav', 'nutter', 'spaz', 'retard',
  'fucker', 'fucking', 'fucked', 'shitty', 'pissed', 'pissing', 'douche', 'douchebag',
  'jackass', 'bullshit', 'horseshit', 'cockhead', 'cum', 'jizz', 'semen', 'turd', 'fart',
  'queer', 'dyke', 'tranny', 'kike', 'spic', 'wop', 'gook', 'chink', 'paki', 'kraut',
  'nip', 'dago', 'mick', 'taig', 'abo', 'boong', 'coon', 'honky', 'redskin', 'squaw',
  'wetback', 'beaner', 'greaser', 'goober', 'cracker', 'peckerwood', 'ofay', 'haole',
  'gook', 'zipperhead', 'slope', 'dink', 'brownie', 'sandnigger', 'cameljockey', 'raghead',
  'towelhead', 'hajji', 'jihad', 'infidel', 'kafir', 'mullah', 'taliban', 'alqaeda',
  
  // Sayı kombinasyonları
  '31', '69', '420', 'seks', 'sex', 'porn', 'porno', 'nude', 'çıplak', 'ciplak',
  
  // Eklenen sayısal ve cinsel terimler
  'anal', 'blowjob', 'handjob', 'orgasm', 'masturbate', 'wank', 'jerkoff', 'fellate',
  'cunnilingus', 'fellatio', '69', 'threesome', 'gangbang', 'bukkake', 'creampie',
  
  // Spam/offensive patterns
  'admin', 'moderator', 'mod', 'system', 'zenshin', 'anilist', 'official',
  'hitler', 'nazi', 'isis', 'terrorist',
  
  // Eklenen spam ve offensive terimler
  'spam', 'bot', 'hack', 'phish', 'scam', 'fraud', 'racist', 'sexist', 'homophobe',
  'bigot', 'fascist', 'communist', 'capitalist', 'zionist', 'antisemite', 'islamophobe',
  'xenophobe', 'misogynist', 'pedophile', 'rapist', 'murderer', 'killer', 'genocide'
];

export const checkProfanity = (text) => {
  if (!text || typeof text !== 'string') {
    return {
      isClean: false,
      bannedWords: []
    };
  }

  const lowerText = text.toLowerCase();
  const foundWords = [];

  for (const word of BANNED_WORDS) {
    if (lowerText.includes(word.toLowerCase())) {
      foundWords.push(word);
    }
  }

  return {
    isClean: foundWords.length === 0,
    bannedWords: foundWords
  };
};
