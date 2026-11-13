/* ============================================================
   TIDEGLASS Web · 内容页
   页脚和正文里一共有 8 个内容页链接（Our Story / Materials / Contact /
   Shipping & Duties / Returns / Care Guide / Size Guide / FAQ），
   加上底栏三个法务页（Privacy / Terms / Accessibility）和 Journal。
   这些页面是纯静态文案，不涉及取数，所以单独成文件，不塞进 views.js。

   文案里的数字（免运门槛、运费、退货天数）一律从 S.DB.settings 读，
   不在文案里写死 —— 后台改设置后这些页面必须跟着变，这是本站的硬约束。
   ============================================================ */
(function () {
  'use strict';

  var U = S.U;
  function esc(s) { return U.esc(s); }
  function money(n) { return U.money(n); }

  /* 从设置里取，取不到就给一个安全默认值 —— 内容页绝不能因为设置缺失而空白 */
  function cfg() {
    var s = (S.DB && S.DB.settings) || {};
    return {
      free: s.freeShip != null ? s.freeShip : 95,
      std: s.standardShip != null ? s.standardShip : 6.9,
      exp: s.expressShip != null ? s.expressShip : 18,
      days: s.returnWindowDays != null ? s.returnWindowDays : 30,
      email: 'hello@tideglassjewelry.com',
    };
  }

  var FAQ = [
    ['Will it turn my skin green?',
      'No. Green skin comes from copper or brass reacting with sweat. There is no copper in our base metal, and the PVD layer is inert — nothing leaches into your skin.'],
    ['Can I really shower and swim in it?',
      'Yes. Pool, sea, shower, gym. Rinse in fresh water afterwards and dry with a soft cloth. Thousands of customers wear the same piece for years without taking it off.'],
    ['Is it real gold?',
      'It is 18k gold PVD over 316L stainless steel, not solid gold — which is why a $76 necklace exists. The colour is bonded at a molecular level, so it does not flake the way plating does.'],
    ['How long does a custom piece take?',
      'Five to seven working days in the studio, then standard shipping. We email a photo before it leaves.'],
    ['What if the colour fades?',
      'We replace it. Free, for life, no receipt needed — send a photo to ' + cfg().email + '. That is the entire warranty.'],
    ['Do you ship to the EU?',
      'Not yet. EU GPSR requires an authorised representative and per-country packaging registration, which we are setting up. UK and Canada are live today.'],
    ['How do I find my ring size?',
      'Wrap a strip of paper around the finger, mark it, measure in millimetres. 5 = 49 mm, 6 = 52 mm, 7 = 54 mm, 8 = 57 mm, 9 = 59 mm. The full chart is on the size guide page.'],
    ['Where do you ship from?',
      'Portland, Oregon. Stock sits in a US warehouse, so US orders never see an import bill at the door.'],
  ];

  function prose(html) {
    return '<div class="wrap"><div class="prose">' + html + '</div></div>';
  }

  /* ---------------- 定制需求（FR-S-092 → 后台 A-12） ----------------
     表单只强制两栏：邮箱 + 需求描述。定制单的价值在拿到线索，
     其余字段（款式、数量、交期、参考图）都是加分项，不该拦住提交。 */
  function custom(sent) {
    if (sent) {
      return '<div class="wrap"><div class="prose">' +
        '<p class="prose__meta">Request received</p>' +
        '<h2>Thank you — we have it.</h2>' +
        '<p>Your reference is <b>' + esc(sent) + '</b>. A person (not a bot) reads every request and replies within two working days with a price and a lead time.</p>' +
        '<p>If you want to add a photo later, reply to the confirmation email with your reference in the subject line.</p>' +
        '<p><a href="#/">Back to the shop</a> · <a href="#/custom">Send another request</a></p>' +
        '</div></div>';
    }
    return '<div class="wrap">' +
      '<div class="collhead"><p class="eyebrow">Made to order</p>' +
      '<h1>Make it yours</h1>' +
      '<p>Tell us the piece you have in mind. We quote by email within two working days — no deposit until you approve the price.</p></div>' +
      '<div class="prose">' +
      '<form data-act="custom-req" style="max-width:560px">' +
      '<div class="fld"><label>Your name</label><input name="name" placeholder="Ann Lee"></div>' +
      '<div class="fld"><label>Email</label><input name="email" type="email" placeholder="you@email.com" required></div>' +
      '<div class="fld"><label>What you want made</label><input name="style" placeholder="Signet ring with a wave motif"></div>' +
      '<div class="fld"><label>Quantity</label><input name="qty" type="number" min="1" max="500" value="1"></div>' +
      '<div class="fld"><label>Wanted by</label><input name="dueDate" type="date"></div>' +
      '<div class="fld"><label>Details</label><textarea name="notes" rows="5" required ' +
      'placeholder="Size, finish, the stone you have in mind, anything that helps us quote accurately."></textarea></div>' +
      '<div class="fld"><label>Reference links (optional, one per line)</label>' +
      '<textarea name="refUrls" rows="2" placeholder="https://..."></textarea></div>' +
      '<button class="btn btn--full" type="submit">Send request</button>' +
      '<p class="prose__meta" style="margin-top:14px">We reply in English within two working days. ' +
      'No account needed, and we never share your email.</p>' +
      '</form></div></div>';
  }

  function page(kind) {
    var c = cfg();
    /* 标题与导语优先取后台 A-08 的覆盖值（bootstrap.pages），取不到再用本文件里的原文。
       这样"没配过"和"配成空"都不会让页面变空白。 */
    var head = function (slug, eyebrow, title, intro) {
      var ov = ((S.DB && S.DB.pages) || {})[slug] || {};
      if (ov.title) title = ov.title;
      if (ov.intro) intro = ov.intro;
      return '<div class="wrap"><div class="collhead"><p class="eyebrow">' + esc(eyebrow) + '</p>' +
        '<h1>' + esc(title) + '</h1><p>' + esc(intro) + '</p></div></div>';
    };

    if (kind === 'about') {
      return head('about', 'Since 2024', 'Our story', 'A small studio that makes one thing well: jewellery you never have to take off.') +
        prose(
          '<p>TIDEGLASS started with a complaint. Everything affordable turned the wearer\'s neck green within a month, and everything that lasted cost a week\'s rent. The middle was empty.</p>' +
          '<p>So we went to the material instead of the marketing. 316L stainless steel is what surgical instruments and dive watches are made of — it does not corrode, it does not react with sweat, and it costs almost nothing at scale. Bond 18k gold onto it with physical vapour deposition and you get a piece that survives the sea for the price of two lunches.</p>' +
          '<h2>What we will not do</h2>' +
          '<p>We will not plate brass and call it gold. We will not sell a piece we have not swum in. And we will not run a sale every three weeks to make a full price look like a bargain.</p>' +
          '<h2>Where the money goes</h2>' +
          '<p>1% of every order funds a reef nursery in Hainan and a native woodland planting scheme in Oregon. The receipts go out in our field notes, every quarter.</p>' +
          '<h2>The name</h2>' +
          '<p>A tide glass is the marker left on a shore to read how far the water came. It is a small object that tells you something true. That is the whole ambition.</p>'
        );
    }

    if (kind === 'care') {
      return head('care', 'Care', 'Caring for your piece', '316L steel does not need much. Here is the whole routine.') +
        prose(
          '<h2>The 30-second routine</h2>' +
          '<p>Rinse in fresh water after the sea or the pool, dry with a soft cloth, put it back on. That is it. No polishing cloth, no ultrasonic cleaner, no special drawer.</p>' +
          '<h2>Three things to avoid</h2>' +
          '<ul>' +
          '<li>Silver polish. This is not silver, and the abrasive dulls the PVD layer.</li>' +
          '<li>Perfume sprayed directly onto the metal, repeatedly, for years.</li>' +
          '<li>Chlorine left to dry on the surface. Rinse it off and you are fine.</li>' +
          '</ul>' +
          '<h2>If the colour ever fades</h2>' +
          '<p>Send a photo to ' + esc(c.email) + '. We replace it free, for life, no receipt needed.</p>'
        );
    }

    if (kind === 'shipping') {
      return head('shipping', 'Help', 'Shipping & duties', 'Everything ships from Portland, Oregon. No customs bill at your door.') +
        prose(
          '<h2>Rates and timing</h2>' +
          '<ul>' +
          '<li><b>United States</b> — 3–5 business days, tracked. Free over ' + money(c.free) + ', otherwise ' + money(c.std) + '.</li>' +
          '<li><b>Canada</b> — 5–8 business days, tracked, duties included. Same free threshold.</li>' +
          '<li><b>United Kingdom</b> — 5–8 business days, tracked, VAT included in the displayed price.</li>' +
          '</ul>' +
          '<p>Express is ' + money(c.exp) + ' flat and takes 1–2 business days once the order leaves the warehouse.</p>' +
          '<h2>Customs</h2>' +
          '<p>Because stock is already in the US, US orders never see an import charge. Canadian and UK orders ship DDP — the price you pay at checkout is the price at the door.</p>' +
          '<h2>What we cannot ship</h2>' +
          '<p>The EU is not covered yet. GPSR needs an authorised representative per member state, and we would rather not sell into a market where we cannot handle a return properly.</p>'
        );
    }

    if (kind === 'returns') {
      return head('returns', 'Help', 'Returns & exchanges', c.days + ' days, worn or unworn, and we pay the return label.') +
        prose(
          '<h2>How to start</h2>' +
          '<p>Email ' + esc(c.email) + ' with your order number. We send a prepaid label the same working day, and refund within 3 days of the parcel reaching us.</p>' +
          '<h2>What is covered</h2>' +
          '<ul>' +
          '<li>Anything within ' + c.days + ' days of delivery.</li>' +
          '<li>Worn once or worn daily — we do not inspect for signs of use.</li>' +
          '<li>Faults, at any time. That is the lifetime colour warranty, not the return window.</li>' +
          '</ul>' +
          '<h2>What is not</h2>' +
          '<ul>' +
          '<li>Custom and personalised pieces, unless faulty.</li>' +
          '<li>Lost items with no tracking movement after delivery confirmation.</li>' +
          '</ul>' +
          '<h2>Exchanges</h2>' +
          '<p>Wrong size or wrong finish? We ship the replacement first so you are not waiting twice, then take the original back on the same label.</p>'
        );
    }

    if (kind === 'size-guide') {
      return head('size-guide', 'Help', 'Size guide', 'Three measurements, no printer required.') +
        prose(
          '<h2>Necklaces</h2>' +
          '<ul>' +
          '<li><b>16 in / 40 cm</b> — sits at the collarbone. The everyday length.</li>' +
          '<li><b>18 in / 45 cm</b> — just below the collarbone, layers well with a 16.</li>' +
          '<li><b>20 in / 50 cm</b> — mid-chest, reads as a deliberate pendant drop.</li>' +
          '</ul>' +
          '<h2>Bracelets and anklets</h2>' +
          '<p>Measure the wrist just above the bone with a strip of paper, then add 1.5 cm for a comfortable fit, 2.5 cm if you like it loose. Anklets are sized the same way, 2 cm above the ankle bone.</p>' +
          '<h2>Rings</h2>' +
          '<ul>' +
          '<li>Size 5 — 49 mm circumference</li>' +
          '<li>Size 6 — 52 mm</li>' +
          '<li>Size 7 — 54 mm</li>' +
          '<li>Size 8 — 57 mm</li>' +
          '<li>Size 9 — 59 mm</li>' +
          '</ul>' +
          '<p>Between two sizes, take the larger one. Our bands are 1.4 mm wide, so they do not need extra clearance.</p>' +
          '<h2>Still unsure</h2>' +
          '<p>Email ' + esc(c.email) + ' with a photo of the piece sitting where you plan to wear it. We answer with a size recommendation, not a sales pitch.</p>'
        );
    }

    if (kind === 'materials') {
      return head('materials', 'Materials', 'What it is made of', 'Two materials, both boring on purpose.') +
        prose(
          '<h2>316L stainless steel</h2>' +
          '<p>The same alloy as surgical instruments and dive watch cases. It contains no copper and no nickel leach, it does not corrode in salt water, and it holds a polish for years. It is also the reason we can sell a necklace for the price of a takeaway dinner.</p>' +
          '<h2>18k gold PVD</h2>' +
          '<p>Physical vapour deposition bonds a gold layer at the molecular level rather than gluing it on. The result is 0.3–0.5 microns of real 18k gold that flexes with the steel instead of flaking off it. Plating fails because it sits on the surface; PVD is part of the surface.</p>' +
          '<h2>Freshwater pearls</h2>' +
          '<p>Baroque and near-round, farmed, never dyed. Each one is a different shape — that is not a defect, it is the reason the strand does not look like it came out of a mould.</p>' +
          '<h2>What we do not use</h2>' +
          '<ul>' +
          '<li>Brass, copper, or zinc alloy cores.</li>' +
          '<li>Nickel release above the EU limit.</li>' +
          '<li>Lead in solder, or cadmium in any component.</li>' +
          '<li>Plastic "gemstones". If it is glass, we say glass.</li>' +
          '</ul>'
        );
    }

    if (kind === 'contact') {
      return head('contact', 'Contact', 'Talk to a person', 'One inbox, answered by whoever packed your order.') +
        prose(
          '<h2>Email</h2>' +
          '<p><a href="mailto:' + esc(c.email) + '">' + esc(c.email) + '</a><br>Replies within one business day, usually the same afternoon.</p>' +
          '<h2>Order enquiries</h2>' +
          '<p>Include the order number (<code>#TG…</code>) so we do not have to ask. If it is about a fit, a photo helps more than a description.</p>' +
          '<h2>Custom work</h2>' +
          '<p>We take a small number of custom pieces each month. Send the motif, the metal, and the deadline — if it is under three weeks out we will tell you honestly whether it is possible.</p>' +
          '<h2>Press and wholesale</h2>' +
          '<p>Same address, subject line <b>PRESS</b> or <b>WHOLESALE</b>. We answer both.</p>' +
          '<h2>Where we are</h2>' +
          '<p>Studio and fulfilment: Portland, Oregon. There is no walk-in shop — everything ships.</p>'
        );
    }

    if (kind === 'faq') {
      return head('faq', 'Help', 'Frequently asked', 'Short answers to the things people email us about most.') +
        prose(FAQ.map(function (q) {
          return '<details class="faq-item"><summary>' + esc(q[0]) + '</summary><p>' + esc(q[1]) + '</p></details>';
        }).join(''));
    }

    if (kind === 'privacy') {
      return head('privacy', 'Legal', 'Privacy policy', 'What we collect, why, and how to get rid of it.') +
        prose(
          '<p class="prose__meta">Last updated 13 November 2026</p>' +
          '<h2>What we collect</h2>' +
          '<p>Order details (name, shipping address, email), and anonymous page analytics. We do not buy data, and we do not sell it — not to advertisers, not to brokers.</p>' +
          '<h2>Cookies</h2>' +
          '<p>Two, unless you accept more: a session cookie that holds your bag, and an analytics cookie. No advertising trackers are set before you consent, and the banner remembers your answer for twelve months.</p>' +
          '<h2>Payment data</h2>' +
          '<p>Card numbers never touch our servers. Stripe processes the payment and gives us a token and the last four digits. We store the token, not the card.</p>' +
          '<h2>How long we keep it</h2>' +
          '<p>Order records for seven years, because tax authorities require it. Analytics for twenty-six months. Marketing consent until you withdraw it.</p>' +
          '<h2>Your rights</h2>' +
          '<p>Under GDPR and CCPA you can ask for a copy of your data, its correction, or its deletion. Email ' + esc(c.email) + ' and we respond within 30 days, no explanation required.</p>'
        );
    }

    if (kind === 'terms') {
      return head('terms', 'Legal', 'Terms of service', 'The plain-language version.') +
        prose(
          '<p class="prose__meta">Last updated 13 November 2026</p>' +
          '<h2>Orders</h2>' +
          '<p>An order is accepted when it ships. Until then we may cancel it — if a piece sold out between your click and our warehouse, you get a full refund and an email, not a silent substitution.</p>' +
          '<h2>Prices</h2>' +
          '<p>All prices are in USD and include applicable duties for DDP destinations. We do not add a customs charge at the door. If a price was listed in error we will contact you before charging, never after.</p>' +
          '<h2>Warranty</h2>' +
          '<p>The lifetime colour warranty covers colour change, not physical damage or loss. We replace, we do not repair.</p>' +
          '<h2>Returns</h2>' +
          '<p>' + c.days + ' days from delivery, worn or unworn, as described on the returns page. Custom pieces are excluded unless faulty.</p>' +
          '<h2>Liability</h2>' +
          '<p>Our liability is limited to the value of the order. Nothing here excludes rights you have under consumer law where you live.</p>'
        );
    }

    if (kind === 'accessibility') {
      return head('accessibility', 'Legal', 'Accessibility', 'Where we are, and what we are fixing.') +
        prose(
          '<p>The store targets WCAG 2.2 AA. Body text is 15px with a 1.65 line height, every interactive element is reachable by keyboard, focus is always visible, and colour is never the only signal — status pills carry text as well as hue.</p>' +
          '<h2>Known gaps</h2>' +
          '<ul>' +
          '<li>The product gallery does not yet support swipe gestures with a screen reader.</li>' +
          '<li>Some older journal articles have insufficient caption contrast.</li>' +
          '<li>The 3D jewellery preview has no non-visual equivalent — the description carries the detail.</li>' +
          '</ul>' +
          '<h2>Tell us</h2>' +
          '<p>Found something? Email ' + esc(c.email) + '. Accessibility bugs go to the front of the queue, ahead of new features.</p>'
        );
    }

    if (kind === 'journal') {
      return head('journal', 'Journal', 'Field notes', 'Materials, workshops, and where the 1% goes.') +
        prose(
          '<h2>Why PVD is not plating</h2>' +
          '<p class="prose__meta">Materials · 2 November 2026</p>' +
          '<p>Plating sits on top of the metal and flakes off it. Physical vapour deposition bonds at the molecular level, so the gold layer flexes with the steel underneath. That single difference is why a $76 necklace can survive a year of salt water.</p>' +
          '<h2>Reading a tide glass</h2>' +
          '<p class="prose__meta">Studio · 18 October 2026</p>' +
          '<p>A tide glass is scratched on purpose. The mark records how far the water reached, so the next person knows what the shore is capable of. We borrowed the idea for the brand, and we keep the habit: every quarter we publish what the numbers actually did.</p>' +
          '<h2>Where the 1% went</h2>' +
          '<p class="prose__meta">Giving · 30 September 2026</p>' +
          '<p>Two grants this quarter: a reef nursery in Hainan, and a native woodland planting scheme in Oregon. Receipts are linked from the newsletter, not summarised into a rounded-up number.</p>'
        );
    }

    return null;
  }

  window.PageViews = { page: page, custom: custom, kinds: ['about', 'care', 'shipping', 'returns', 'size-guide', 'faq', 'materials', 'contact', 'privacy', 'terms', 'accessibility', 'journal'] };
})();
