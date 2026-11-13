/**
 * Wildkind 演示数据种子
 * 结构对齐真实 DTC 独立站（Shopify 模型的手写简化版）
 * 运行: node data/seed.js
 */
const fs = require('fs');
const path = require('path');

// ---------- 确定性伪随机，保证每次生成一致 ----------
let _s = 20261112;
const rnd = () => ((_s = (_s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
const daysAgo = (n) => {
  const d = new Date('2026-11-12T10:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString();
};

// ---------- 分类（一级严格对齐 Atolea） ----------
const C = (handle, title, o = {}) => ({
  handle, title,
  level: o.level || 1,
  parent: o.parent || null,
  menuGroup: o.group || null,
  order: o.order || 99,
  nav: o.nav !== false,
  visible: true,
  intro: o.intro || '',
  hero: o.hero || '',
  filter: o.filter || null,
});

const collections = [
  // ===== 一级导航（11 项，与参考站一一对应） =====
  C('best-sellers', 'Best Sellers', { order: 1, intro: 'The pieces our community keeps coming back for.', hero: '/assets/img/hero-necklaces.png' }),
  C('custom', 'Custom', {
    order: 2, intro: 'Your initials, your birth month, your story — made to order in 5 days.',
    hero: '/assets/img/c-woodland.png',
  }),
  C('sale', 'SALE', { order: 3, intro: 'Last-chance pieces. Once they are gone, they are gone.', hero: '/assets/img/c-celestial.png' }),
  C('new', 'New', { order: 4, intro: 'Fresh from the studio, released every other Friday.', hero: '/assets/img/c-ocean.png' }),
  C('necklaces', 'Necklaces', { order: 5, intro: 'Everyday layers, from a 16" choker to a 22" pendant.', hero: '/assets/img/p-necklace-sun-gold.png' }),
  C('rings', 'Rings', { order: 6, intro: 'Stack them, swap them, never take them off.', hero: '/assets/img/p-rings-stack-gold.png' }),
  C('pearls', 'Pearls', { order: 7, intro: 'Freshwater pearls, never dyed, never plastic.', hero: '/assets/img/p-necklace-pearl-gold.png' }),
  C('earrings', 'Earrings', { order: 8, intro: 'Light enough to forget you are wearing them.', hero: '/assets/img/p-earrings-hoop-gold.png' }),
  C('bracelets', 'Bracelets', { order: 9, intro: 'Chains, beads and cuffs for a wrist that swims.', hero: '/assets/img/p-bracelet-clover-silver.png' }),
  C('anklets', 'Anklets', { order: 10, intro: 'Built for sand, salt and summer.', hero: '/assets/img/p-anklet-shell-gold.png' }),
  C('gifts', 'Gifts', { order: 11, intro: 'Ready to give, wrapped in recycled cotton.', hero: '/assets/img/c-ocean.png' }),

  // ===== Custom 下拉 =====
  C('custom-all', 'All Custom Jewelry', { level: 2, parent: 'custom', group: 'Personalized', order: 1 }),
  C('initial-jewelry', 'Initial Jewelry', { level: 2, parent: 'custom', group: 'Personalized', order: 2 }),
  C('birthstone-jewelry', 'Birthstone Jewelry', { level: 2, parent: 'custom', group: 'Personalized', order: 3 }),
  C('birthstone-necklaces', 'Birthstone Necklaces', { level: 2, parent: 'custom', group: 'Personalized', order: 4 }),
  C('birthstone-rings', 'Birthstone Rings', { level: 2, parent: 'custom', group: 'Personalized', order: 5 }),

  // ===== Necklaces 下拉 =====
  C('layered-necklaces', 'Layered Necklaces', { level: 2, parent: 'necklaces', group: 'Shop by style', order: 1 }),
  C('gold-chokers', 'Chokers', { level: 2, parent: 'necklaces', group: 'Shop by style', order: 2 }),
  C('pendant-necklaces', 'Pendant Necklaces', { level: 2, parent: 'necklaces', group: 'Shop by style', order: 3 }),

  // ===== Rings 下拉 =====
  C('stacking-rings', 'Stacking Rings', { level: 2, parent: 'rings', group: 'Shop by style', order: 1 }),
  C('signet-rings', 'Signet Rings', { level: 2, parent: 'rings', group: 'Shop by style', order: 2 }),

  // ===== Pearls 下拉 =====
  C('pearl-necklaces', 'Pearl Necklaces', { level: 2, parent: 'pearls', group: 'Pearls', order: 1 }),
  C('pearl-bracelets', 'Pearl Bracelets', { level: 2, parent: 'pearls', group: 'Pearls', order: 2 }),
  C('pearl-earrings', 'Pearl Earrings', { level: 2, parent: 'pearls', group: 'Pearls', order: 3 }),

  // ===== Earrings 下拉 =====
  C('hoop-earrings', 'Hoop Earrings', { level: 2, parent: 'earrings', group: 'Shop by style', order: 1 }),
  C('huggie-earrings', 'Huggie Earrings', { level: 2, parent: 'earrings', group: 'Shop by style', order: 2 }),
  C('stud-earrings', 'Studs', { level: 2, parent: 'earrings', group: 'Shop by style', order: 3 }),

  // ===== Bracelets 下拉 =====
  C('thin-bracelets', 'Thin Bracelets', { level: 2, parent: 'bracelets', group: 'Shop by style', order: 1 }),
  C('chain-bracelets', 'Chain Bracelets', { level: 2, parent: 'bracelets', group: 'Shop by style', order: 2 }),
  C('beaded-bracelets', 'Beaded Bracelets', { level: 2, parent: 'bracelets', group: 'Shop by style', order: 3 }),

  // ===== Anklets 下拉 =====
  C('shell-anklets', 'Shell Anklets', { level: 2, parent: 'anklets', group: 'Shop by style', order: 1 }),
  C('chain-anklets', 'Chain Anklets', { level: 2, parent: 'anklets', group: 'Shop by style', order: 2 }),

  // ===== 自然主题（Gifts 下拉的 Nature & Meaning 组） =====
  C('ocean', 'Ocean', { level: 2, parent: 'gifts', group: 'Nature & Meaning', order: 1 }),
  C('woodland', 'Woodland', { level: 2, parent: 'gifts', group: 'Nature & Meaning', order: 2 }),
  C('celestial', 'Moon & Stars', { level: 2, parent: 'gifts', group: 'Nature & Meaning', order: 3 }),
  C('floral', 'Floral', { level: 2, parent: 'gifts', group: 'Nature & Meaning', order: 4 }),
  C('protection', 'Protection', { level: 2, parent: 'gifts', group: 'Nature & Meaning', order: 5 }),

  // ===== Gifts 下拉的 Gifts & Occasions 组 =====
  C('for-her', 'For Her', { level: 2, parent: 'gifts', group: 'Gifts & Occasions', order: 1 }),
  C('for-him', 'For Him', { level: 2, parent: 'gifts', group: 'Gifts & Occasions', order: 2 }),
  C('gifts-for-mom', 'Gifts for Mom', { level: 2, parent: 'gifts', group: 'Gifts & Occasions', order: 3 }),
  C('birthday-gifts', 'Birthday Gifts', { level: 2, parent: 'gifts', group: 'Gifts & Occasions', order: 4 }),
  C('gift-sets', 'Gift Sets', { level: 2, parent: 'gifts', group: 'Gifts & Occasions', order: 5 }),

  // ===== Metals 组（用筛选实现，不是独立集合页） =====
  C('metal-gold', '18k Gold', { level: 2, parent: 'necklaces', group: 'Metals', order: 1, nav: false, filter: { metal: 'Gold' } }),
  C('metal-silver', 'Silver', { level: 2, parent: 'necklaces', group: 'Metals', order: 2, nav: false, filter: { metal: 'Silver' } }),
  C('metal-rose', 'Rose Gold', { level: 2, parent: 'necklaces', group: 'Metals', order: 3, nav: false, filter: { metal: 'Rose Gold' } }),
];

// ---------- 商品 ----------
const P = (o) => ({
  id: o.id,
  handle: o.handle,
  title: o.title,
  collections: o.collections,
  price: o.price,
  compareAt: o.compareAt || null,
  cost: o.cost ?? Math.round(o.price * 0.125 * 100) / 100,
  stock: o.stock ?? int(8, 60),
  image: o.image,
  imageAlt: o.imageAlt || o.image,
  motif: o.motif || 'leaf',
  metal: o.metal || 'Gold',
  metals: o.metals || ['Gold', 'Silver'],
  sizes: o.sizes || null,
  badge: o.badge || null,
  rating: o.rating ?? Math.round((4.4 + rnd() * 0.55) * 10) / 10,
  reviews: o.reviews ?? int(18, 380),
  desc: o.desc,
  details: o.details || {},
  featured: o.featured ?? 0,
  status: o.status || 'active',
  createdAt: daysAgo(o.age ?? int(5, 300)),
});

const IMG = {
  fox: '/assets/img/p-necklace-fox-gold.png',
  sun: '/assets/img/p-necklace-sun-gold.png',
  turtle: '/assets/img/p-necklace-turtle-silver.png',
  pearlN: '/assets/img/p-necklace-pearl-gold.png',
  moon: '/assets/img/p-necklace-moon-silver.png',
  clover: '/assets/img/p-bracelet-clover-silver.png',
  beaded: '/assets/img/p-bracelet-beaded-gold.png',
  hoop: '/assets/img/p-earrings-hoop-gold.png',
  rings: '/assets/img/p-rings-stack-gold.png',
  anklet: '/assets/img/p-anklet-shell-gold.png',
  lifestyle: '/assets/img/hero-necklaces.png',
};

const products = [
  // ---------- Necklaces ----------
  P({
    id: 'TG-101', handle: 'foxtrot-pendant-necklace', title: 'Foxtrot Pendant Necklace',
    collections: ['necklaces', 'best-sellers', 'pendant-necklaces', 'woodland', 'for-her'],
    price: 62, compareAt: 78, cost: 7.4, stock: 34, image: IMG.fox, imageAlt: IMG.lifestyle,
    motif: 'fox', sizes: ['16"', '18"', '20"'], badge: 'Best Seller', featured: 1, age: 8,
    desc: 'A fox caught mid-step, cut from a single sheet of steel so the negative space draws the ear and the tail. It sits just below the collarbone and never catches on a collar.',
    details: { material: '316L stainless steel, 18k gold PVD', pendant: '16 × 14 mm', chain: '1.6 mm cable, 16–20 in', weight: '3.1 g' },
  }),
  P({
    id: 'TG-102', handle: 'moonlit-hare-necklace', title: 'Moonlit Hare Necklace',
    collections: ['necklaces', 'best-sellers', 'pendant-necklaces', 'woodland'],
    price: 58, cost: 6.8, stock: 21, image: IMG.moon, imageAlt: IMG.lifestyle,
    motif: 'hare', sizes: ['16"', '18"'], badge: 'New', featured: 1, age: 3,
    desc: 'A hare in mid-leap with a crescent moon tucked behind its ears. The kind of small, quiet detail people notice on the second look.',
    details: { material: '316L stainless steel, rhodium finish', pendant: '14 × 18 mm', chain: '1.4 mm cable, 16–18 in', weight: '2.9 g' },
  }),
  P({
    id: 'TG-103', handle: 'solstice-sun-necklace', title: 'Solstice Sun Necklace',
    collections: ['necklaces', 'best-sellers', 'pendant-necklaces', 'celestial', 'birthday-gifts'],
    price: 64, compareAt: 80, cost: 7.6, stock: 42, image: IMG.sun, imageAlt: IMG.lifestyle,
    motif: 'sun', sizes: ['16"', '18"'], badge: 'Best Seller', featured: 1, age: 12,
    desc: 'A hammered disc with a hand-drawn sunburst. The surface is brushed so it catches light the way still water does — bright, then soft, then bright again.',
    details: { material: '316L stainless steel, 18k gold PVD', pendant: '15 mm disc', chain: '1.6 mm cable, 16–18 in', weight: '3.4 g' },
  }),
  P({
    id: 'TG-104', handle: 'sea-turtle-necklace', title: 'Sea Turtle Necklace',
    collections: ['necklaces', 'ocean', 'pendant-necklaces', 'best-sellers'],
    price: 66, cost: 7.9, stock: 17, image: IMG.turtle, imageAlt: IMG.lifestyle,
    motif: 'turtle', metal: 'Silver', metals: ['Silver', 'Gold'], sizes: ['16"', '18"', '20"'], featured: 1, age: 20,
    desc: 'Modelled on a green turtle we saw off Hainan. The shell is engraved, not printed, so the pattern stays after a hundred swims. 1% of every sale funds a reef nursery.',
    details: { material: '316L stainless steel, rhodium finish', pendant: '18 × 16 mm', chain: '1.4 mm cable, 16–20 in', weight: '3.0 g' },
  }),
  P({
    id: 'TG-105', handle: 'coral-bloom-necklace', title: 'Coral Bloom Necklace',
    collections: ['necklaces', 'ocean', 'for-her'],
    price: 72, compareAt: 88, cost: 8.6, stock: 26, image: IMG.turtle, imageAlt: IMG.lifestyle,
    motif: 'coral', sizes: ['16"', '18"'], badge: 'Low stock', age: 32,
    desc: 'Branching coral, abstracted into six strokes. Reads as a flower from far away and as coral up close — which is exactly the point.',
    details: { material: '316L stainless steel, 18k gold PVD', pendant: '20 × 22 mm', chain: '1.4 mm cable, 16–18 in', weight: '3.6 g' },
  }),
  P({
    id: 'TG-106', handle: 'fern-frond-necklace', title: 'Fern Frond Necklace',
    collections: ['necklaces', 'woodland', 'pendant-necklaces'],
    price: 52, cost: 6.1, stock: 48, image: IMG.fox, imageAlt: IMG.lifestyle,
    motif: 'fern', sizes: ['16"', '18"', '20"'], age: 44,
    desc: 'One frond, uncurling. Cast from a real leaf so the veins are accurate at 1:1 scale.',
    details: { material: '316L stainless steel, 18k gold PVD', pendant: '11 × 26 mm', chain: '1.4 mm cable, 16–20 in', weight: '2.6 g' },
  }),
  P({
    id: 'TG-107', handle: 'clover-chain-necklace', title: 'Clover Chain Necklace',
    collections: ['necklaces', 'floral', 'for-her', 'birthday-gifts'],
    price: 56, compareAt: 68, cost: 6.5, stock: 39, image: IMG.sun, imageAlt: IMG.lifestyle,
    motif: 'clover', sizes: ['16"', '18"'], badge: 'Best Seller', age: 60,
    desc: 'Four leaves, one centre. Small enough to wear with everything, which is why it is the piece customers tell us they never take off.',
    details: { material: '316L stainless steel, 18k gold PVD', pendant: '10 mm', chain: '1.4 mm cable, 16–18 in', weight: '2.4 g' },
  }),
  P({
    id: 'TG-108', handle: 'tidepool-choker', title: 'Tidepool Choker',
    collections: ['necklaces', 'ocean', 'gold-chokers'],
    price: 48, cost: 5.6, stock: 31, image: IMG.anklet, imageAlt: IMG.lifestyle,
    motif: 'shell', sizes: ['14"', '16"'], age: 70,
    desc: 'A 14-inch choker with three cowrie shells, spaced unevenly on purpose. Stack it with a longer pendant chain.',
    details: { material: '316L stainless steel, 18k gold PVD', shells: 'Natural cowrie, 8–10 mm', chain: '1.2 mm cable, 14–16 in', weight: '2.2 g' },
  }),
  P({
    id: 'TG-109', handle: 'hummingbird-locket', title: 'Hummingbird Locket',
    collections: ['necklaces', 'woodland', 'pendant-necklaces', 'for-her'],
    price: 84, compareAt: 104, cost: 10.1, stock: 12, image: IMG.pearlN, imageAlt: IMG.lifestyle,
    motif: 'hummingbird', metals: ['Gold'], sizes: ['18"', '20"'], badge: 'Low stock', age: 15,
    desc: 'A locket the size of a thumbnail, with a hummingbird engraved on the face. Opens to hold one photo or one line of handwriting.',
    details: { material: '316L stainless steel, 18k gold PVD', pendant: '18 mm locket', chain: '1.6 mm cable, 18–20 in', weight: '4.8 g' },
  }),

  // ---------- Rings ----------
  P({
    id: 'TG-201', handle: 'stargazer-stacking-rings', title: 'Stargazer Stacking Rings',
    collections: ['rings', 'stacking-rings', 'celestial', 'best-sellers'],
    price: 78, compareAt: 96, cost: 9.4, stock: 29, image: IMG.rings, imageAlt: IMG.lifestyle,
    motif: 'star', sizes: ['5', '6', '7', '8', '9'], badge: 'Best Seller', featured: 1, age: 6,
    desc: 'Three rings meant to be worn together: one plain band, one twisted, one set with a single star. Sold as a set, sized so they sit flush.',
    details: { material: '316L stainless steel, 18k gold PVD', bands: '1.2 / 1.4 / 1.6 mm', set: '3 rings', weight: '4.2 g' },
  }),
  P({
    id: 'TG-202', handle: 'sun-signet-ring', title: 'Sun Signet Ring',
    collections: ['rings', 'signet-rings', 'celestial'],
    price: 54, cost: 6.3, stock: 36, image: IMG.rings, imageAlt: IMG.lifestyle,
    motif: 'sun', sizes: ['5', '6', '7', '8', '9'], age: 38,
    desc: 'An oval face with a sun engraved in the centre. Heavy enough to feel like something, light enough to sleep in.',
    details: { material: '316L stainless steel, 18k gold PVD', face: '11 × 9 mm oval', band: '2.4 mm', weight: '4.6 g' },
  }),
  P({
    id: 'TG-203', handle: 'wave-band-ring', title: 'Wave Band Ring',
    collections: ['rings', 'stacking-rings', 'ocean'],
    price: 46, cost: 5.4, stock: 44, image: IMG.rings, imageAlt: IMG.lifestyle,
    motif: 'wave', sizes: ['5', '6', '7', '8', '9'], age: 52,
    desc: 'One continuous wave around the finger, no beginning and no end. The easiest ring to stack.',
    details: { material: '316L stainless steel, 18k gold PVD', band: '1.8 mm', weight: '2.8 g' },
  }),
  P({
    id: 'TG-204', handle: 'moonphase-ring', title: 'Moonphase Ring',
    collections: ['rings', 'celestial', 'for-her'],
    price: 62, compareAt: 74, cost: 7.2, stock: 18, image: IMG.rings, imageAlt: IMG.lifestyle,
    motif: 'moon', metals: ['Gold', 'Silver'], sizes: ['5', '6', '7', '8'], badge: 'New', age: 2,
    desc: 'A crescent cut into the band so the finger shows through — the moon changes shape depending on which way you turn your hand.',
    details: { material: '316L stainless steel, 18k gold PVD', band: '2.2 mm', weight: '3.4 g' },
  }),
  P({
    id: 'TG-205', handle: 'leaf-wrap-ring', title: 'Leaf Wrap Ring',
    collections: ['rings', 'woodland', 'stacking-rings'],
    price: 52, cost: 6.1, stock: 33, image: IMG.rings, imageAlt: IMG.lifestyle,
    motif: 'leaf', sizes: ['5', '6', '7', '8', '9'], age: 66,
    desc: 'A fern leaf that wraps twice around the finger, tapering to a point. Adjustable by half a size.',
    details: { material: '316L stainless steel, 18k gold PVD', band: '1.6 mm, wraps 1.7×', weight: '3.0 g' },
  }),

  // ---------- Bracelets ----------
  P({
    id: 'TG-301', handle: 'clover-charm-bracelet', title: 'Clover Charm Bracelet',
    collections: ['bracelets', 'chain-bracelets', 'floral', 'best-sellers'],
    price: 54, compareAt: 66, cost: 6.3, stock: 27, image: IMG.clover, imageAlt: IMG.lifestyle,
    motif: 'clover', metal: 'Silver', metals: ['Silver', 'Gold'], sizes: ['S', 'M', 'L'], badge: 'Best Seller', featured: 1, age: 10,
    desc: 'One clover, off-centre, on a chain fine enough to disappear under a sleeve. Our most gifted piece under $60.',
    details: { material: '316L stainless steel, rhodium finish', charm: '9 mm', chain: '1.2 mm rolo, 16–19 cm', weight: '2.1 g' },
  }),
  P({
    id: 'TG-302', handle: 'wildflower-beaded-bracelet', title: 'Wildflower Beaded Bracelet',
    collections: ['bracelets', 'beaded-bracelets', 'floral', 'birthday-gifts'],
    price: 62, cost: 7.2, stock: 22, image: IMG.beaded, imageAlt: IMG.lifestyle,
    motif: 'flower', metals: ['Gold'], sizes: ['S', 'M', 'L'], age: 25,
    desc: 'Pressed wildflowers between glass beads — no two bracelets are identical because no two flowers are.',
    details: { material: '316L steel beads, lampwork glass, 18k gold PVD', bead: '6 mm', elastic: '0.8 mm, double-strung', weight: '5.2 g' },
  }),
  P({
    id: 'TG-303', handle: 'driftwood-chain-bracelet', title: 'Driftwood Chain Bracelet',
    collections: ['bracelets', 'chain-bracelets', 'ocean'],
    price: 58, cost: 6.8, stock: 35, image: IMG.beaded, imageAlt: IMG.lifestyle,
    motif: 'wave', sizes: ['S', 'M', 'L'], age: 41,
    desc: 'Paperclip links with a hand-textured finish that looks like sun-bleached wood. The clasp is a lobster claw, not a spring ring — it does not fail.',
    details: { material: '316L stainless steel, 18k gold PVD', link: '4 × 11 mm paperclip', length: '16–19 cm', weight: '6.4 g' },
  }),
  P({
    id: 'TG-304', handle: 'seahorse-bracelet', title: 'Seahorse Bracelet',
    collections: ['bracelets', 'ocean', 'for-her'],
    price: 56, cost: 6.5, stock: 19, image: IMG.clover, imageAlt: IMG.lifestyle,
    motif: 'seahorse', sizes: ['S', 'M', 'L'], badge: 'New', age: 4,
    desc: 'A seahorse the length of a fingernail, curled around the chain. Modelled from a specimen, not a cartoon.',
    details: { material: '316L stainless steel, 18k gold PVD', charm: '6 × 15 mm', chain: '1.2 mm rolo, 16–19 cm', weight: '2.4 g' },
  }),
  P({
    id: 'TG-305', handle: 'fern-cuff', title: 'Fern Cuff',
    collections: ['bracelets', 'thin-bracelets', 'woodland'],
    price: 68, compareAt: 82, cost: 8.0, stock: 14, image: IMG.beaded, imageAlt: IMG.lifestyle,
    motif: 'fern', metals: ['Gold'], sizes: ['M', 'L'], badge: 'Low stock', age: 18,
    desc: 'An open cuff with a fern impressed into the outer face. Squeeze it gently to fit — it holds its shape.',
    details: { material: '316L stainless steel, 18k gold PVD', width: '6 mm', diameter: '58 mm, open', weight: '9.8 g' },
  }),

  // ---------- Anklets ----------
  P({
    id: 'TG-401', handle: 'cowrie-anklet', title: 'Cowrie Anklet',
    collections: ['anklets', 'shell-anklets', 'ocean', 'best-sellers'],
    price: 48, cost: 5.6, stock: 40, image: IMG.anklet, imageAlt: IMG.lifestyle,
    motif: 'shell', sizes: ['One size'], badge: 'Best Seller', featured: 1, age: 14,
    desc: 'Three cowrie shells on a 9-inch chain with a 1-inch extender. Made for water — the shells are sealed, so they do not cloud.',
    details: { material: '316L stainless steel, 18k gold PVD', shells: 'Natural cowrie, sealed', length: '23 + 3 cm', weight: '2.6 g' },
  }),
  P({
    id: 'TG-402', handle: 'starfish-anklet', title: 'Starfish Anklet',
    collections: ['anklets', 'shell-anklets', 'ocean'],
    price: 46, cost: 5.3, stock: 33, image: IMG.anklet, imageAlt: IMG.lifestyle,
    motif: 'starfish', sizes: ['One size'], age: 47,
    desc: 'A single starfish, slightly off-centre, so it sits on the ankle bone instead of sliding to the back.',
    details: { material: '316L stainless steel, 18k gold PVD', charm: '12 mm', length: '23 + 3 cm', weight: '2.4 g' },
  }),
  P({
    id: 'TG-403', handle: 'wave-chain-anklet', title: 'Wave Chain Anklet',
    collections: ['anklets', 'chain-anklets', 'ocean'],
    price: 42, cost: 4.9, stock: 52, image: IMG.anklet, imageAlt: IMG.lifestyle,
    motif: 'wave', sizes: ['One size'], age: 58,
    desc: 'A plain herringbone chain that lies flat against the ankle. The one to wear when you do not want anyone to notice.',
    details: { material: '316L stainless steel, 18k gold PVD', chain: '2.5 mm herringbone', length: '23 + 3 cm', weight: '3.2 g' },
  }),
  P({
    id: 'TG-404', handle: 'daisy-chain-anklet', title: 'Daisy Chain Anklet',
    collections: ['anklets', 'chain-anklets', 'floral', 'birthday-gifts'],
    price: 44, compareAt: 54, cost: 5.1, stock: 26, image: IMG.anklet, imageAlt: IMG.lifestyle,
    motif: 'flower', sizes: ['One size'], age: 22,
    desc: 'Tiny daisies linked nose to tail. Reads as a plain chain from a metre away, which is the joke.',
    details: { material: '316L stainless steel, 18k gold PVD', daisy: '5 mm', length: '23 + 3 cm', weight: '2.8 g' },
  }),

  // ---------- Earrings ----------
  P({
    id: 'TG-501', handle: 'sunburst-hoops', title: 'Sunburst Hoops',
    collections: ['earrings', 'hoop-earrings', 'celestial', 'best-sellers'],
    price: 52, cost: 6.1, stock: 44, image: IMG.hoop, imageAlt: IMG.lifestyle,
    motif: 'sun', sizes: ['12 mm', '16 mm', '22 mm'], badge: 'Best Seller', featured: 1, age: 9,
    desc: 'Chunky enough to read from across a room, light enough to forget by lunch. 4.1 g for the pair.',
    details: { material: '316L stainless steel, 18k gold PVD', diameter: '12 / 16 / 22 mm', weight: '4.1 g / pair' },
  }),
  P({
    id: 'TG-502', handle: 'fern-huggies', title: 'Fern Huggies',
    collections: ['earrings', 'huggie-earrings', 'woodland'],
    price: 46, cost: 5.3, stock: 38, image: IMG.hoop, imageAlt: IMG.lifestyle,
    motif: 'fern', sizes: ['8 mm', '10 mm'], age: 34,
    desc: 'A huggie with a fern engraved along the outside edge. Sits flush against the lobe, so it never catches on a towel.',
    details: { material: '316L stainless steel, 18k gold PVD', diameter: '8 / 10 mm', closure: 'Hinged snap', weight: '1.8 g / pair' },
  }),
  P({
    id: 'TG-503', handle: 'pearl-drop-earrings', title: 'Pearl Drop Earrings',
    collections: ['earrings', 'pearl-earrings', 'pearls', 'for-her'],
    price: 58, compareAt: 72, cost: 6.8, stock: 23, image: IMG.pearlN, imageAlt: IMG.lifestyle,
    motif: 'pearl', metals: ['Gold', 'Silver'], sizes: ['One size'], badge: 'New', age: 5,
    desc: 'One freshwater pearl, 9 mm, on a thin bar. The pearl is baroque, so the pair is never perfectly symmetrical — we think that is the better version.',
    details: { material: '316L steel, 18k gold PVD, freshwater pearl', pearl: '9–10 mm baroque', drop: '22 mm', weight: '2.2 g / pair' },
  }),
  P({
    id: 'TG-504', handle: 'crescent-studs', title: 'Crescent Studs',
    collections: ['earrings', 'stud-earrings', 'celestial'],
    price: 42, cost: 4.9, stock: 50, image: IMG.hoop, imageAlt: IMG.lifestyle,
    motif: 'moon', metals: ['Gold', 'Silver'], sizes: ['One size'], age: 55,
    desc: 'A crescent the size of a grain of rice. Small, sharp and slightly asymmetric — the everyday stud for people who hate studs.',
    details: { material: '316L stainless steel, 18k gold PVD', size: '6 mm', closure: 'Push back', weight: '0.9 g / pair' },
  }),
  P({
    id: 'TG-505', handle: 'bee-studs', title: 'Bee Studs',
    collections: ['earrings', 'stud-earrings', 'floral'],
    price: 44, cost: 5.1, stock: 29, image: IMG.hoop, imageAlt: IMG.lifestyle,
    motif: 'bee', sizes: ['One size'], age: 62,
    desc: 'A bee with engraved stripes and two tiny wings. The wings are cut out, so light passes through them.',
    details: { material: '316L stainless steel, 18k gold PVD', size: '9 × 7 mm', closure: 'Push back', weight: '1.2 g / pair' },
  }),

  // ---------- Pearls ----------
  P({
    id: 'TG-601', handle: 'baroque-pearl-necklace', title: 'Baroque Pearl Necklace',
    collections: ['pearls', 'pearl-necklaces', 'best-sellers', 'for-her'],
    price: 82, compareAt: 98, cost: 9.8, stock: 16, image: IMG.pearlN, imageAlt: IMG.lifestyle,
    motif: 'pearl', metals: ['Gold', 'Silver'], sizes: ['16"', '18"'], badge: 'Best Seller', featured: 1, age: 11,
    desc: 'A single baroque freshwater pearl on a fine chain. Because the pearl is irregular, each necklace has a slightly different silhouette.',
    details: { material: '316L steel, 18k gold PVD, freshwater pearl', pearl: '14–16 mm baroque', chain: '1.2 mm cable, 16–18 in', weight: '3.8 g' },
  }),
  P({
    id: 'TG-602', handle: 'pearl-strand-bracelet', title: 'Pearl Strand Bracelet',
    collections: ['pearls', 'pearl-bracelets', 'for-her', 'gifts-for-mom'],
    price: 68, cost: 8.0, stock: 24, image: IMG.beaded, imageAlt: IMG.lifestyle,
    motif: 'pearl', metals: ['Gold', 'Silver'], sizes: ['S', 'M', 'L'], age: 30,
    desc: 'Seven freshwater pearls, hand-knotted on silk, with a gold-filled clasp. The version of a pearl bracelet you can actually wear every day.',
    details: { material: 'Freshwater pearls, silk thread, 14k gold-filled clasp', pearl: '6–7 mm', length: '16–19 cm', weight: '6.1 g' },
  }),
  P({
    id: 'TG-603', handle: 'pearl-hoop-earrings', title: 'Pearl Hoop Earrings',
    collections: ['pearls', 'pearl-earrings', 'earrings', 'earth'],
    price: 64, compareAt: 78, cost: 7.5, stock: 20, image: IMG.clover, imageAlt: IMG.lifestyle,
    motif: 'pearl', metals: ['Gold'], sizes: ['One size'], age: 27,
    desc: 'A thin gold hoop with three pearls threaded on. It moves when you move, which is the whole reason to wear it.',
    details: { material: '316L steel, 18k gold PVD, freshwater pearls', hoop: '20 mm', pearl: '5 mm × 3', weight: '3.4 g / pair' },
  }),

  // ---------- Custom ----------
  P({
    id: 'TG-701', handle: 'initial-charm-necklace', title: 'Initial Charm Necklace',
    collections: ['custom', 'custom-all', 'initial-jewelry', 'best-sellers'],
    price: 66, cost: 7.7, stock: 60, image: IMG.fox, imageAlt: IMG.lifestyle,
    motif: 'letter', metals: ['Gold', 'Silver', 'Rose Gold'], sizes: ['16"', '18"'], badge: 'Custom', featured: 1, age: 7,
    desc: 'One hand-finished initial, 12 mm, on a chain of your chosen length. Up to three initials per necklace — they stack without tangling.',
    details: { material: '316L stainless steel, 18k gold PVD', initial: '12 mm, hand-polished', lead: 'Dispatched in 5 working days', weight: '3.2 g' },
  }),
  P({
    id: 'TG-702', handle: 'birthstone-ring', title: 'Toi et Moi Birthstone Ring',
    collections: ['custom', 'custom-all', 'birthstone-jewelry', 'birthstone-rings'],
    price: 76, compareAt: 92, cost: 8.9, stock: 42, image: IMG.rings, imageAlt: IMG.lifestyle,
    motif: 'gem', metals: ['Gold', 'Silver'], sizes: ['5', '6', '7', '8', '9'], badge: 'Custom', age: 13,
    desc: 'Two stones, side by side — you and one other person. Choose any two of the twelve birth months; we set them in the order you send them.',
    details: { material: '316L steel, 18k gold PVD, cubic zirconia', stone: '4 mm × 2', lead: 'Dispatched in 7 working days', weight: '3.6 g' },
  }),
  P({
    id: 'TG-703', handle: 'name-bracelet', title: 'Custom Name Bracelet',
    collections: ['custom', 'custom-all', 'initial-jewelry', 'for-her'],
    price: 74, cost: 8.6, stock: 38, image: IMG.clover, imageAlt: IMG.lifestyle,
    motif: 'name', metals: ['Gold', 'Silver'], sizes: ['S', 'M', 'L'], badge: 'Custom', age: 16,
    desc: 'Up to 10 letters, cut individually and soldered link by link. Choose block or script; script is slightly wider.',
    details: { material: '316L stainless steel, 18k gold PVD', letters: 'Up to 10, 10 mm tall', lead: 'Dispatched in 7 working days', weight: '5.8 g' },
  }),

  // ---------- Gifts ----------
  P({
    id: 'TG-801', handle: 'woodland-gift-set', title: 'Woodland Gift Set',
    collections: ['gifts', 'gift-sets', 'woodland', 'for-her'],
    price: 96, compareAt: 124, cost: 11.5, stock: 18, image: IMG.fox, imageAlt: IMG.lifestyle,
    motif: 'fox', metals: ['Gold'], sizes: ['One size'], badge: 'Gift', featured: 1, age: 1,
    desc: 'The Foxtrot pendant, the Fern huggies and a recycled cotton pouch. Our best-selling pairing, boxed and ready to give.',
    details: { material: '316L stainless steel, 18k gold PVD', includes: 'Pendant necklace + huggies + pouch', lead: 'Dispatched in 2 working days', weight: '7.0 g' },
  }),
  P({
    id: 'TG-802', handle: 'ocean-gift-set', title: 'Ocean Gift Set',
    collections: ['gifts', 'gift-sets', 'ocean', 'for-her'],
    price: 92, compareAt: 118, cost: 10.9, stock: 21, image: IMG.turtle, imageAlt: IMG.lifestyle,
    motif: 'turtle', metal: 'Silver', metals: ['Silver'], sizes: ['One size'], badge: 'Gift', age: 19,
    desc: 'The Sea Turtle necklace, the Cowrie anklet and a pouch. Packed in a recycled box with a card explaining the reef nursery your order funds.',
    details: { material: '316L stainless steel, rhodium finish', includes: 'Necklace + anklet + pouch', lead: 'Dispatched in 2 working days', weight: '5.6 g' },
  }),
];

// ---------- 客户 & 订单 ----------
const NAMES = [
  ['Emily Carter', 'emily.carter'], ['Sophie Bennett', 'sophie.bennett'], ['Hannah Reid', 'hannah.reid'],
  ['Olivia Grant', 'olivia.grant'], ['Maya Patel', 'maya.patel'], ['Chloe Simmons', 'chloe.simmons'],
  ['Isabella Moore', 'bella.moore'], ['Grace Turner', 'grace.turner'], ['Ava Mitchell', 'ava.mitchell'],
  ['Lauren Hughes', 'lauren.hughes'], ['Rachel Adler', 'rachel.adler'], ['Nina Rossi', 'nina.rossi'],
  ['Kate Sullivan', 'kate.sullivan'], ['Amelia Frost', 'amelia.frost'], ['Zoe Martin', 'zoe.martin'],
  ['Ella Novak', 'ella.novak'], ['Sarah Kim', 'sarah.kim'], ['Freya Larsen', 'freya.larsen'],
  ['Megan Doyle', 'megan.doyle'], ['Julia Costa', 'julia.costa'], ['Claire Dubois', 'claire.dubois'],
  ['Alice Wong', 'alice.wong'], ['Naomi Silva', 'naomi.silva'], ['Rebecca Shaw', 'rebecca.shaw'],
];
const CITIES = [
  ['Portland', 'OR'], ['Austin', 'TX'], ['Brooklyn', 'NY'], ['Denver', 'CO'], ['Seattle', 'WA'],
  ['Chicago', 'IL'], ['Boston', 'MA'], ['San Diego', 'CA'], ['Nashville', 'TN'], ['Minneapolis', 'MN'],
  ['Toronto', 'ON'], ['Vancouver', 'BC'], ['London', ''], ['Manchester', ''],
];

const customers = [];
const orders = [];
let orderSeq = 1040;

// 客户池：132 个唯一身份，订单按 70% 新客 / 30% 复购入池
const SUFFIX = ['gmail.com', 'outlook.com', 'icloud.com', 'yahoo.com'];
const POOL = [];
for (let i = 0; i < 132; i++) {
  const [name, slug] = NAMES[i % NAMES.length];
  const round = Math.floor(i / NAMES.length);
  POOL.push({
    name,
    email: `${slug}${round ? round + 1 : ''}@${SUFFIX[i % SUFFIX.length]}`,
    city: CITIES[i % CITIES.length][0],
    state: CITIES[i % CITIES.length][1],
  });
}
let poolCursor = 0;
const assigned = [];

for (let i = 0; i < 186; i++) {
  let cust;
  if (assigned.length > 4 && rnd() < 0.3) {
    cust = pick(assigned);
  } else if (poolCursor < POOL.length) {
    cust = POOL[poolCursor++];
    assigned.push(cust);
  } else {
    cust = pick(assigned);
  }
  const { name, email, city, state } = cust;
  const country = city === 'Toronto' || city === 'Vancouver' ? 'Canada' : city === 'London' || city === 'Manchester' ? 'United Kingdom' : 'United States';
  const d = int(0, 89);
  const createdAt = daysAgo(d);

  const nItems = rnd() > 0.72 ? 2 : rnd() > 0.94 ? 3 : 1;
  const chosen = [];
  for (let k = 0; k < nItems; k++) {
    const p = pick(products.filter((x) => x.status === 'active'));
    if (chosen.find((c) => c.productId === p.id)) continue;
    chosen.push({
      productId: p.id, title: p.title, variant: p.metals[0], size: p.sizes ? p.sizes[0] : 'One size',
      qty: 1, price: p.price, cost: p.cost,
    });
  }
  if (!chosen.length) continue;

  const subtotal = chosen.reduce((s, it) => s + it.price * it.qty, 0);
  const shipping = subtotal >= 75 ? 0 : 6.9;
  const discount = rnd() > 0.82 ? Math.round(subtotal * 0.1 * 100) / 100 : 0;
  const total = Math.round((subtotal + shipping - discount) * 100) / 100;

  let status = 'fulfilled';
  if (d < 2) status = pick(['paid', 'paid', 'fulfilling']);
  else if (d < 8) status = pick(['fulfilled', 'fulfilled', 'fulfilled', 'fulfilling', 'paid']);
  else if (rnd() > 0.965) status = 'refunded';

  orderSeq += 1;
  orders.push({
    id: 'o_' + (1000 + orders.length),
    number: '#TG' + orderSeq,
    createdAt,
    status,
    items: chosen,
    customer: { name, email, city, state, country },
    subtotal, shipping, discount, total,
    channel: rnd() > 0.62 ? 'Meta Ads' : rnd() > 0.4 ? 'Organic' : 'Email',
    tracking: status === 'fulfilled' ? '9400' + int(1000000000, 9999999999) : null,
  });
}

// 客户聚合
const byEmail = new Map();
for (const o of orders) {
  const k = o.customer.email;
  if (!byEmail.has(k)) {
    byEmail.set(k, {
      email: k, name: o.customer.name, city: o.customer.city,
      country: o.customer.country, orders: 0, spent: 0, first: o.createdAt, last: o.createdAt,
    });
  }
  const c = byEmail.get(k);
  if (['paid', 'fulfilled'].includes(o.status)) {
    c.orders += 1;
    c.spent = Math.round((c.spent + o.total) * 100) / 100;
  }
  if (o.createdAt < c.first) c.first = o.createdAt;
  if (o.createdAt > c.last) c.last = o.createdAt;
}
for (const c of byEmail.values()) customers.push(c);

// ---------- 站点内容 ----------
const content = {
  announcement: [
    'Free US & CA shipping over $75',
    'Lifetime colour warranty — no receipt needed',
    'Waterproof, sweatproof, swim-proof',
  ],
  hero: {
    eyebrow: 'Waterproof · Tarnish-free · Lifetime warranty',
    title: 'Nature, worn close.',
    body: 'Small animals, sea things and night skies — cast in steel, finished by hand, made to survive the shower, the ocean and the years.',
    cta: 'Shop best sellers',
    ctaHref: '/collections/best-sellers',
    image: '/assets/img/hero-necklaces.png',
    caption: 'The Solstice necklace, worn daily since 2024.',
  },
  usps: [
    { title: 'Free shipping over $75', body: 'Tracked, 3–5 days in the US, 5–8 in CA and UK.' },
    { title: 'Lifetime colour warranty', body: 'If it fades, we replace it. No receipt, no questions.' },
    { title: '30-day returns', body: 'Wear it, swim in it, send it back if it is not right.' },
    { title: '1% for the wild', body: 'Every order funds a reef or woodland nursery.' },
  ],
  story: {
    title: 'A small studio with a long memory',
    body: [
      'Wildkind started with a fox pendant that would not survive a shower. We wanted the animals we grew up drawing to be things you could wear in the sea, sleep in, and hand to someone else ten years later.',
      'Everything is 316L stainless steel with a PVD finish — the same material used in watch cases. It does not turn your skin green, it does not fade in chlorine, and it does not need to be taken off.',
      'We design in Shenzhen, sample in Chang\'an, and ship from Portland. That last part is why a $62 necklace can reach Oregon in three days.',
    ],
  },
  testimonials: [
    { quote: 'I wear the Solstice every single day — gym, shower, sea. Six months in and it looks like the day it arrived.', name: 'Julia R.', meta: 'Verified buyer · Solstice Sun Necklace', stars: 5 },
    { quote: 'Bought the fox for my daughter and ended up ordering a second for myself. The size is perfect, not costume-y at all.', name: 'Tracy L.', meta: 'Verified buyer · Foxtrot Pendant', stars: 5 },
    { quote: 'Wore the cowrie anklet for two weeks in Portugal. Salt, sand, pool — zero change in colour. Genuinely impressed.', name: 'Lily M.', meta: 'Verified buyer · Cowrie Anklet', stars: 5 },
    { quote: 'The clover bracelet is now the only bracelet I own. It has not left my wrist since March.', name: 'Michelle K.', meta: 'Verified buyer · Clover Charm Bracelet', stars: 5 },
  ],
  journal: [
    { title: 'Why stainless steel beats sterling silver for everyday', tag: 'Materials', date: '2026-10-28', slug: 'steel-vs-silver' },
    { title: 'Inside the Chang\'an workshop that makes our castings', tag: 'Studio', date: '2026-10-11', slug: 'changan-workshop' },
    { title: 'The reef nursery your orders funded this quarter', tag: '1% for the wild', date: '2026-09-22', slug: 'reef-nursery' },
  ],
};

// ---------- 设置 ----------
const settings = {
  brandName: 'Wildkind',
  tagline: 'Nature, worn close.',
  domain: 'wildkind.co',
  currency: 'USD',
  adminEmail: 'studio@wildkind.co',
  adminPassword: 'wildkind2026',
  freeShippingThreshold: 75,
  monthlyTarget: 14000,
  costs: {
    dutyRate: 0.31,        // 中国产地仿首饰综合税率（301 + IEEPA 叠加后）
    freightRate: 0.055,    // 头程海运 + 清关分摊
    fulfillment: 9.8,      // 3PL 仓配 + 尾程（美国本土）
    paymentRate: 0.029,    // Stripe
    paymentFixed: 0.3,
    returnsRate: 0.06,
    packaging: 0.85,
  },
  warehouses: [
    { name: 'Portland 3PL', city: 'Portland, OR', skus: 28, units: 742, lead: '2–4 days' },
    { name: 'Shenzhen studio', city: 'Shenzhen, CN', skus: 38, units: 1860, lead: 'Restock only' },
  ],
};

const db = {
  meta: { generatedAt: new Date().toISOString(), version: '1.0.0', productCount: products.length, orderCount: orders.length },
  settings, collections, products, customers, orders, content,
};

const out = path.join(__dirname, 'db.json');
fs.writeFileSync(out, JSON.stringify(db, null, 2));
const paid = orders.filter((o) => ['paid', 'fulfilled'].includes(o.status));
console.log('✓ db.json 已生成');
console.log('  商品', products.length, '| 集合', collections.length, '| 订单', orders.length, '| 客户', customers.length);
console.log('  GMV $' + paid.reduce((s, o) => s + o.total, 0).toFixed(2), '| AOV $' + (paid.reduce((s, o) => s + o.total, 0) / paid.length).toFixed(2));
