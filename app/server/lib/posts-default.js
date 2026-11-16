/* ============================================================
   LASTGROVE · 博客种子数据（3 篇旧文迁移）
   ============================================================

   这三篇原来躺在 pages.js 的 journal 页面里，是「一段 h2 + 一段正文」的静态文案。
   博客上线后它们必须是 published：现在前台本来就看得见，迁移成草稿等于内容下线，
   是功能回退（FRS FR-B-041 / SDS D-8）。

   只在 db.posts 缺失时灌入一次（store.normalize），之后一律以 db.json 为准。
   线上要改这三篇，去后台 Articles 改，不要回来改这个文件。

   封面一律留空：没有素材。列表页会用 .jcard--ni 纯文字卡兜底，
   塞一张不相关的库存图比没有图更差。
   ============================================================ */
'use strict';

module.exports = [
  {
    id: 'Pmfa1k2c',
    slug: 'why-pvd-is-not-plating',
    title: 'Why PVD is not plating',
    excerpt: 'Plating sits on top. PVD bonds. The difference decides whether your necklace survives a year of salt water.',
    coverImage: '',
    coverAlt: '',
    section: 'materials',
    status: 'published',
    publishedAt: '2026-11-02T09:00:00.000Z',
    updatedAt: '2026-11-02T09:00:00.000Z',
    createdAt: '2026-11-02T08:40:00.000Z',
    seoTitle: '',
    seoDescription: 'Why 18k PVD over 316L steel holds its colour where electroplating flakes: a molecular bond instead of a layer sitting on top.',
    cta: { label: 'Shop the necklaces', href: '/#/collections/necklaces' },
    relatedProduct: '',
    readMinutes: 2,
    blocks: [
      { type: 'p', text: 'Plating sits on top of the metal and flakes off it. Physical vapour deposition bonds at the molecular level, so the gold layer flexes with the steel underneath. That single difference is why a $76 necklace can survive a year of salt water.' },
      { type: 'hr' },
      { type: 'h2', text: 'What plating actually is' },
      { type: 'p', text: 'Electroplating dips jewellery in a bath and drives metal ions onto the surface with current. The result is a **layer**, usually between 0.5 and 2 microns thick. It sits *on* the steel rather than in it, which is fine until the piece bends, scratches or sweats.' },
      { type: 'p', text: 'Once that layer is breached, the steel underneath is exposed and the colour change starts at the edges — the clasp first, then the points where a chain rubs against itself.' },
      { type: 'h2', text: 'What PVD does instead' },
      { type: 'p', text: 'Physical vapour deposition takes a solid gold target, vaporises it in a vacuum, and lets the metal condense onto the steel. The gold does not sit on the surface; it becomes the surface, bonded at the atomic level.' },
      { type: 'ul', items: [
        'No bath, no cyanide chemistry — the process is dry',
        'The colour layer is a fraction of a micron, but it is not a coating that can peel',
        'Because the bond is structural, bending the piece does not crack the finish'
      ] },
      { type: 'quote', text: 'The colour is not a coating. It is the surface.', cite: 'Studio notes' },
      { type: 'h2', text: 'What this means in practice' },
      { type: 'p', text: 'Swim in it. Shower in it. Sleep in it. The failure mode of PVD is not flaking but slow abrasion at the highest-friction points, which is why we finish the clasp separately.' },
      { type: 'p', text: 'Silver pieces are left unplated on purpose — no layer means nothing to wear through. Gold pieces get the 18k PVD treatment, and the lifetime colour warranty covers colour change rather than physical damage.' },
      { type: 'h2', text: 'The 0.3 micron question' },
      { type: 'p', text: 'Thicker is not automatically better. Beyond a certain thickness the layer stops flexing with the substrate and starts behaving like a coating again. We spec a working range rather than a marketing number, and we test it in salt water rather than on a spec sheet.' }
    ]
  },
  {
    id: 'Pmfa1k2d',
    slug: 'reading-a-tide-glass',
    title: 'Reading a tide glass',
    excerpt: 'A scratched bottle on a windowsill, and what it taught us about publishing numbers we would rather round up.',
    coverImage: '',
    coverAlt: '',
    section: 'studio',
    status: 'published',
    publishedAt: '2026-10-18T09:00:00.000Z',
    updatedAt: '2026-10-18T09:00:00.000Z',
    createdAt: '2026-10-18T08:40:00.000Z',
    seoTitle: '',
    seoDescription: 'Why we borrowed the tide glass — a bottle scratched to record how far the water reached — as the model for how we publish our numbers.',
    cta: { label: 'Read the materials page', href: '/#/pages/materials' },
    relatedProduct: '',
    readMinutes: 2,
    blocks: [
      { type: 'p', text: 'A tide glass is scratched on purpose. The mark records how far the water reached, so the next person knows what the shore is capable of. We borrowed the idea for the brand, and we keep the habit: every quarter we publish what the numbers actually did.' },
      { type: 'hr' },
      { type: 'h2', text: 'How a tide glass works' },
      { type: 'p', text: 'A bottle is fixed at the shoreline with a narrow opening. Water enters at high tide and drains slowly. Someone scratches a line at the highest point the water reached, and writes the date beside it.' },
      { type: 'p', text: 'Over a season the bottle becomes a record no single measurement could give you: not the average tide, not the forecast, but *the highest water this shore has actually seen*.' },
      { type: 'h2', text: 'Why we stole it' },
      { type: 'p', text: 'Brand reporting tends to round toward the flattering number — the pledged amount, not the transferred one; the best month, not the year. A tide glass cannot round. The line is where the water was.' },
      { type: 'quote', text: 'Mark the high water, not the intended high water.', cite: 'Studio notes' },
      { type: 'h2', text: 'What we publish' },
      { type: 'ul', items: [
        'Units shipped, not units planned',
        'What the 1% line actually moved, with receipts linked from the newsletter',
        'What broke — the products we pulled, and why'
      ] },
      { type: 'p', text: 'This is not a moral position so much as a practical one. A number you cannot round is a number you cannot quietly walk back later.' }
    ]
  },
  {
    id: 'Pmfa1k2e',
    slug: 'where-the-1-percent-went',
    title: 'Where the 1% went',
    excerpt: 'Two grants this quarter: a reef nursery in Hainan, and a native woodland planting scheme in Oregon.',
    coverImage: '',
    coverAlt: '',
    section: 'giving',
    status: 'published',
    publishedAt: '2026-09-30T09:00:00.000Z',
    updatedAt: '2026-09-30T09:00:00.000Z',
    createdAt: '2026-09-30T08:40:00.000Z',
    seoTitle: '',
    seoDescription: 'Quarterly giving report: a reef nursery in Hainan and native woodland planting in Oregon, with receipts rather than a rounded-up total.',
    cta: { label: 'Our story', href: '/#/pages/about' },
    relatedProduct: '',
    readMinutes: 1,
    blocks: [
      { type: 'p', text: 'Two grants this quarter: a reef nursery in Hainan, and a native woodland planting scheme in Oregon. Receipts are linked from the newsletter, not summarised into a rounded-up number.' },
      { type: 'hr' },
      { type: 'h2', text: 'Hainan — reef nursery' },
      { type: 'p', text: 'Coral fragments are grown on frames in sheltered water, then transplanted onto degraded reef. It is slow work measured in years, which is exactly why it needs a recurring line item rather than a one-off campaign.' },
      { type: 'h2', text: 'Oregon — native woodland' },
      { type: 'p', text: 'Planting native species on land that had been cleared. The scheme prioritises species that support insect life, on the reasoning that a woodland which feeds nothing is a plantation.' },
      { type: 'h2', text: 'How the 1% is counted' },
      { type: 'p', text: 'One percent of revenue, not profit. Revenue is the number that exists before anyone has an argument about what counts as profit, and it is the number a customer can roughly check against what they paid.' },
      { type: 'ul', items: [
        'Counted per order, at the moment the order is paid',
        'Transferred quarterly, not annually — the recipient should not wait a year for money already set aside',
        'Receipts published as links, never as a total we computed ourselves'
      ] }
    ]
  }
];
