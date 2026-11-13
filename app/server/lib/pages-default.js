/* ============================================================
   TIDEGLASS · 内容页默认文案（导语层）
   这些值与 app/web/assets/js/pages.js 里各页 head() 的原始文案一一对应。
   存在这里的意义：后台 A-08「内容」需要一个可编辑的落点。
   编辑范围只到「标题 + 导语」——正文段落仍在 pages.js，
   这是本版明确的边界，不假装能改（见 SDD 第 16 节）。
   ============================================================ */
'use strict';

module.exports = {
  about: { slug: 'about', title: 'Our story', intro: 'A small studio that makes one thing well: jewellery you never have to take off.' },
  care: { slug: 'care', title: 'Caring for your piece', intro: '316L steel does not need much. Here is the whole routine.' },
  shipping: { slug: 'shipping', title: 'Shipping & duties', intro: 'Everything ships from Portland, Oregon. No customs bill at your door.' },
  returns: { slug: 'returns', title: 'Returns & exchanges', intro: '30 days, worn or unworn, and we pay the return label.' },
  'size-guide': { slug: 'size-guide', title: 'Size guide', intro: 'Three measurements, no printer required.' },
  materials: { slug: 'materials', title: 'What it is made of', intro: 'Two materials, both boring on purpose.' },
  contact: { slug: 'contact', title: 'Talk to a person', intro: 'One inbox, answered by whoever packed your order.' },
  faq: { slug: 'faq', title: 'Frequently asked', intro: 'Short answers to the things people email us about most.' },
  privacy: { slug: 'privacy', title: 'Privacy policy', intro: 'What we collect, why, and how to get rid of it.' },
  terms: { slug: 'terms', title: 'Terms of service', intro: 'The plain-language version.' },
  accessibility: { slug: 'accessibility', title: 'Accessibility', intro: 'Where we are, and what we are fixing.' },
  journal: { slug: 'journal', title: 'Field notes', intro: 'Materials, workshops, and where the 1% goes.' },
};
