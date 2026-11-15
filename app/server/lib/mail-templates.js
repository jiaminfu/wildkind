/* ============================================================
   LASTGROVE · 事务邮件模板
   三封：订单确认 / 已发货 / 已退款。

   为什么不用外链 CSS、也不用 <style> 块：
   Gmail 会剥掉 <head> 里的样式，Outlook 对 flex/grid 基本不支持。
   全部写成 table + 内联样式是唯一在主流邮箱客户端里都稳定的做法。
   丑一点没关系，读不了才要命。
   ============================================================ */
'use strict';

const SEA = '#1B3A34';
const SEA_D = '#132B26';
const CREAM = '#FAF6EF';
const SAND = '#E7DAC8';
const INK = '#16130F';
const MUTED = '#6E675E';

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

/* 金额只在美国站用，统一 USD；整数不补零，和前台一致 */
function money(n) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  return '$' + v.toFixed(2).replace(/\.00$/, '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

/* 承运商查询页。与前端 core.js 的 U.carriers 必须保持一致——
   这是服务端副本，改一处要同步另一处（SDS 里已标注该耦合）。 */
const CARRIERS = {
  usps: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=',
  ups: 'https://www.ups.com/track?tracknum=',
  fedex: 'https://www.fedex.com/fedextrack/?trknbr=',
  dhl: 'https://www.dhl.com/us-en/home/tracking.html?tracking-id=',
  'canada post': 'https://www.canadapost-postescanada.ca/track-reperage/en#/search?searchFor=',
  'royal mail': 'https://www.royalmail.com/track-your-item#/tracking-results/',
};

function trackUrl(carrier, no) {
  const n = String(no || '').trim();
  if (!n) return '';
  const prefix = CARRIERS[String(carrier || '').trim().toLowerCase()] || 'https://t.17track.net/en#nums=';
  return prefix + encodeURIComponent(n);
}

/* 外框：所有邮件共用 */
function shell(opts) {
  const site = opts.site || 'https://lastgrove.com';
  return '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="x-apple-disable-message-reformatting">' +
    '<title>' + esc(opts.subject) + '</title></head>' +
    '<body style="margin:0;padding:0;background:' + SAND + ';">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;">' + esc(opts.preheader || '') + '</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:' + SAND + ';padding:30px 12px;">' +
    '<tr><td align="center">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" ' +
    'style="max-width:560px;background:' + CREAM + ';border:1px solid ' + SAND + ';">' +

    /* 页头 */
    '<tr><td style="padding:26px 30px 20px;border-bottom:1px solid ' + SAND + ';">' +
    '<div style="font-family:Georgia,\'Times New Roman\',serif;font-size:18px;letter-spacing:.22em;' +
    'color:' + SEA + ';text-transform:uppercase;">LASTGROVE</div>' +
    '</td></tr>' +

    '<tr><td style="padding:30px 30px 8px;">' + opts.body + '</td></tr>' +

    /* 页脚 */
    '<tr><td style="padding:26px 30px 30px;border-top:1px solid ' + SAND + ';">' +
    '<p style="margin:0 0 10px;font:400 12px/1.6 Helvetica,Arial,sans-serif;color:' + MUTED + ';">' +
    'Questions? Reply to this email and a person answers — usually within one business day.' +
    '</p>' +
    '<p style="margin:0;font:400 11px/1.6 Helvetica,Arial,sans-serif;color:' + MUTED + ';">' +
    'LASTGROVE · <a href="' + esc(site) + '" style="color:' + MUTED + ';">lastgrove.com</a><br>' +
    'You are receiving this because you placed an order. This is a service message, not marketing.' +
    '</p>' +
    '</td></tr>' +

    '</table></td></tr></table></body></html>';
}

function button(href, label) {
  return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 6px;">' +
    '<tr><td style="background:' + SEA + ';">' +
    '<a href="' + esc(href) + '" style="display:inline-block;padding:13px 26px;font:400 12px/1 Helvetica,Arial,sans-serif;' +
    'letter-spacing:.12em;text-transform:uppercase;color:' + CREAM + ';text-decoration:none;">' + esc(label) + '</a>' +
    '</td></tr></table>';
}

function itemsTable(order) {
  const rows = (order.items || []).map(i =>
    '<tr>' +
    '<td style="padding:11px 0;border-bottom:1px solid ' + SAND + ';font:400 13px/1.45 Helvetica,Arial,sans-serif;color:' + INK + ';">' +
    esc(i.title) + '<br><span style="color:' + MUTED + ';font-size:11.5px;">' +
    esc(i.variant || '') + (i.size ? ' / ' + esc(i.size) : '') + ' · ×' + (i.qty || 1) + '</span></td>' +
    '<td align="right" style="padding:11px 0;border-bottom:1px solid ' + SAND + ';font:400 13px/1.45 Helvetica,Arial,sans-serif;color:' + INK + ';white-space:nowrap;">' +
    money((i.unitPrice || 0) * (i.qty || 1)) + '</td>' +
    '</tr>').join('');

  const line = (label, value, bold) =>
    '<tr><td style="padding:6px 0;font:' + (bold ? '600' : '400') + ' 12.5px/1.5 Helvetica,Arial,sans-serif;color:' +
    (bold ? INK : MUTED) + ';">' + esc(label) + '</td>' +
    '<td align="right" style="padding:6px 0;font:' + (bold ? '600' : '400') + ' 12.5px/1.5 Helvetica,Arial,sans-serif;color:' +
    (bold ? INK : MUTED) + ';white-space:nowrap;">' + esc(value) + '</td></tr>';

  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">' +
    rows +
    line('Subtotal', money(order.subtotal)) +
    (order.discount ? line('Discount' + (order.couponCode ? ' · ' + order.couponCode : ''), '−' + money(order.discount)) : '') +
    line('Shipping' + (order.shippingMethod ? ' · ' + order.shippingMethod : ''), order.shipping ? money(order.shipping) : 'Free') +
    line('Total paid', money(order.total), true) +
    '</table>';
}

function h1(t) {
  return '<h1 style="margin:0 0 12px;font:400 24px/1.3 Georgia,\'Times New Roman\',serif;color:' + INK + ';">' + esc(t) + '</h1>';
}
function p(t, color) {
  return '<p style="margin:0 0 14px;font:400 13.5px/1.7 Helvetica,Arial,sans-serif;color:' + (color || '#3B3630') + ';">' + t + '</p>';
}
function label(t) {
  return '<div style="font:600 9.5px/1 Helvetica,Arial,sans-serif;letter-spacing:.14em;text-transform:uppercase;' +
    'color:' + MUTED + ';margin:24px 0 9px;">' + esc(t) + '</div>';
}

function orderLink(site, order) {
  return site + '/#/account/lookup?number=' + encodeURIComponent(order.number) +
    '&email=' + encodeURIComponent(order.email || '');
}

/* ---------------- 1. 订单确认 ---------------- */
function confirmed(order, opts) {
  const site = opts.site;
  const link = orderLink(site, order);
  const body =
    h1('Payment received.') +
    p('Thank you — your order is in. We pack and hand it to the carrier within 1–2 business days, ' +
      'and you will get a second email with the tracking number the moment it leaves.') +
    label('Order') +
    '<div style="font:400 14px/1.6 Helvetica,Arial,sans-serif;color:' + INK + ';">' +
    esc(order.number) + '<span style="color:' + MUTED + ';font-size:12px;"> · ' + esc(fmtDate(order.paidAt || order.createdAt)) + '</span></div>' +
    label('What you ordered') +
    itemsTable(order) +
    label('Shipping to') +
    '<div style="font:400 12.5px/1.7 Helvetica,Arial,sans-serif;color:#3B3630;">' +
    esc(order.name || '') + '<br>' +
    esc([order.address && order.address.line1, order.address && order.address.line2].filter(Boolean).join(', ')) + '<br>' +
    esc([order.address && order.address.city, order.address && order.address.state, order.address && order.address.zip].filter(Boolean).join(' ')) + '<br>' +
    esc((order.address && order.address.country) || '') +
    '</div>' +
    button(link, 'View your order') +
    p('<span style="color:' + MUTED + ';font-size:12px;">Keep this email — the order number and link above are all you need to check status. ' +
      'Duties are included, so there is nothing to pay at the door.</span>');

  return {
    subject: 'Order ' + order.number + ' confirmed — LASTGROVE',
    preheader: 'Payment received. Ships in 1–2 business days.',
    html: shell({ site, subject: 'Order confirmed', preheader: 'Payment received. Ships in 1–2 business days.', body }),
    text: [
      'LASTGROVE — payment received',
      '',
      'Order ' + order.number + ' · ' + fmtDate(order.paidAt || order.createdAt),
      '',
      (order.items || []).map(i => '  ' + (i.qty || 1) + ' × ' + i.title + ' (' + (i.variant || '') + (i.size ? ' / ' + i.size : '') + ') — ' + money((i.unitPrice || 0) * (i.qty || 1))).join('\n'),
      '',
      'Subtotal ' + money(order.subtotal),
      (order.discount ? 'Discount −' + money(order.discount) : null),
      'Shipping ' + (order.shipping ? money(order.shipping) : 'Free'),
      'Total paid ' + money(order.total),
      '',
      'Shipping to:',
      order.name || '',
      [order.address && order.address.line1, order.address && order.address.line2].filter(Boolean).join(', '),
      [order.address && order.address.city, order.address && order.address.state, order.address && order.address.zip].filter(Boolean).join(' '),
      (order.address && order.address.country) || '',
      '',
      'View your order: ' + link,
      '',
      'We pack and ship within 1–2 business days. You will get the tracking number by email.',
      'Duties are included — nothing to pay at the door.',
      '',
      'Questions? Just reply to this email.',
    ].filter(x => x !== null && x !== undefined).join('\n'),
  };
}

/* ---------------- 2. 已发货 ---------------- */
function shipped(order, opts) {
  const site = opts.site;
  const url = trackUrl(order.carrier, order.tracking);
  const link = orderLink(site, order);
  const body =
    h1('On its way.') +
    p('Your order left our studio. ' +
      (order.carrier ? 'It is travelling with <b>' + esc(order.carrier) + '</b>. ' : '') +
      'Most US addresses see it in 3–5 business days from here.') +
    label('Tracking number') +
    '<div style="font:400 20px/1.4 \'Courier New\',Courier,monospace;color:' + INK + ';letter-spacing:.02em;">' +
    esc(order.tracking) + '</div>' +
    (url ? button(url, 'Track with ' + (order.carrier || 'carrier')) : '') +
    label('In this order') +
    itemsTable(order) +
    button(link, 'View your order') +
    p('<span style="color:' + MUTED + ';font-size:12px;">Tracking can take up to 24 hours to show its first scan — ' +
      'carriers scan in batches at the depot, not when the label is printed.</span>');

  return {
    subject: 'Your LASTGROVE order ' + order.number + ' has shipped',
    preheader: (order.carrier ? order.carrier + ' ' : '') + (order.tracking || ''),
    html: shell({ site, subject: 'Shipped', preheader: (order.carrier || '') + ' ' + (order.tracking || ''), body }),
    text: [
      'LASTGROVE — your order has shipped',
      '',
      'Order ' + order.number,
      'Carrier ' + (order.carrier || '—'),
      'Tracking ' + (order.tracking || '—'),
      '',
      url ? 'Track it: ' + url : '',
      '',
      'View your order: ' + link,
      '',
      'Most US addresses see it 3–5 business days from dispatch.',
      'Tracking can take up to 24 hours to show its first scan.',
      '',
      'Questions? Just reply to this email.',
    ].filter(Boolean).join('\n'),
  };
}

/* ---------------- 3. 已退款 ---------------- */
function refunded(order, opts) {
  const site = opts.site || 'https://lastgrove.com';
  const amount = opts.amount != null ? opts.amount : order.refundAmount;
  const link = orderLink(site, order);
  const body =
    h1('Refund issued.') +
    p('We have refunded <b>' + esc(money(amount)) + '</b> on order ' + esc(order.number) + '. ' +
      'Nothing else is needed from you.') +
    p('Depending on your bank, the money takes <b>3–5 business days</b> to appear on your statement. ' +
      'It goes back to the same account you paid with.') +
    label('Order') +
    '<div style="font:400 13px/1.7 Helvetica,Arial,sans-serif;color:#3B3630;">' +
    esc(order.number) + '<br>Original total ' + esc(money(order.total)) + '<br>Refunded ' + esc(money(amount)) +
    '</div>' +
    button(link, 'View the order') +
    p('<span style="color:' + MUTED + ';font-size:12px;">If the refund has not landed after five business days, ' +
      'reply to this email with the order number and we will trace it.</span>');

  return {
    subject: 'Refund issued for order ' + order.number,
    preheader: money(amount) + ' refunded · 3–5 business days',
    html: shell({ site, subject: 'Refund issued', preheader: money(amount) + ' refunded', body }),
    text: [
      'LASTGROVE — refund issued',
      '',
      'Order ' + order.number,
      'Original total ' + money(order.total),
      'Refunded ' + money(amount),
      '',
      'The money returns to the account you paid with and takes 3–5 business days to appear.',
      '',
      'View the order: ' + link,
      '',
      'If it has not landed after five business days, reply to this email.',
    ].join('\n'),
  };
}

module.exports = { confirmed, shipped, refunded, money, trackUrl, esc };
