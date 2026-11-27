// Excel and PDF exports (libraries load only when used)
import { state } from './store.js';

function download(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export async function toExcel(filename, sheets) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();
  sheets.forEach((s) => {
    const ws = XLSX.utils.json_to_sheet(s.rows.length ? s.rows : [{ Note: 'No data' }]);
    const keys = Object.keys(s.rows[0] || { Note: '' });
    ws['!cols'] = keys.map((k) => ({ wch: Math.min(40, Math.max(k.length + 2, ...s.rows.map((r) => String(r[k] ?? '').length + 1))) }));
    XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
  });
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  download(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), filename.endsWith('.xlsx') ? filename : filename + '.xlsx');
}

// columns: [{ header, key, align }] rows: objects; summary: [[label, value]]
export async function toPDF(filename, title, subtitle, columns, rows, summary = []) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ orientation: columns.length > 6 ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  doc.setFillColor(11, 61, 46); doc.rect(0, 0, W, 64, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
  doc.text(state.settings.business_name || 'Anayo 5PS Enterprises', 40, 30);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text('Sales & inventory report · generated ' + new Date().toLocaleString('en-GB', { timeZone: 'Africa/Lagos' }), 40, 48);
  doc.setTextColor(20, 32, 26); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
  doc.text(title, 40, 96);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(91, 102, 95);
  if (subtitle) doc.text(subtitle, 40, 112);
  let y = 126;
  if (summary.length) {
    doc.setTextColor(20, 32, 26);
    summary.forEach(([k, v], i) => {
      const x = 40 + (i % 3) * ((W - 80) / 3);
      if (i && i % 3 === 0) y += 34;
      doc.setFontSize(9); doc.setTextColor(91, 102, 95); doc.text(String(k), x, y);
      doc.setFontSize(12); doc.setTextColor(20, 32, 26); doc.setFont('helvetica', 'bold'); doc.text(String(v).replace('₦', 'NGN '), x, y + 15);
      doc.setFont('helvetica', 'normal');
    });
    y += 34;
  }
  autoTable(doc, {
    startY: y,
    head: [columns.map((c) => c.header)],
    body: rows.map((r) => columns.map((c) => String(r[c.key] ?? '').replace(/₦/g, 'NGN '))),
    styles: { fontSize: 9, cellPadding: 5 },
    headStyles: { fillColor: [11, 122, 85], textColor: 255 },
    alternateRowStyles: { fillColor: [245, 246, 243] },
    columnStyles: Object.fromEntries(columns.map((c, i) => [i, { halign: c.align || 'left' }])),
    margin: { left: 40, right: 40 },
  });
  download(doc.output('blob'), filename.endsWith('.pdf') ? filename : filename + '.pdf');
}

// A4 invoice for the Full invoice sale mode (and any past sale)
export async function invoicePDF(r) {
  const { jsPDF } = await import('jspdf');
  const autoTable = (await import('jspdf-autotable')).default;
  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const N = (v) => 'NGN ' + Number(v || 0).toLocaleString('en-NG', { maximumFractionDigits: 2 });
  const s = state.settings;
  const no = r.receipt_no ? `INV-${String(r.receipt_no).padStart(5, '0')}` : 'INV-PENDING';
  doc.setFillColor(11, 61, 46); doc.rect(0, 0, W, 90, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(20);
  doc.text(s.business_name || 'Anayo 5PS Enterprises', 40, 42);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
  doc.text([s.phone ? 'Tel: ' + s.phone : '', 'Wholesale · Sales invoice'].filter(Boolean).join('   ·   '), 40, 62);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(22); doc.text('INVOICE', W - 40, 46, { align: 'right' });
  doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.text(no, W - 40, 64, { align: 'right' });

  doc.setTextColor(20, 32, 26);
  let y = 122;
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.text('BILL TO', 40, y);
  doc.text('DETAILS', W / 2 + 20, y);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11);
  const c = r.customer || {};
  doc.text([c.name || 'Customer', c.phone || '', c.address || ''].filter(Boolean), 40, y + 16);
  const date = new Date(r.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Africa/Lagos' });
  doc.text([`Invoice date: ${date}`, r.dueDate ? `Payment due: ${new Date(r.dueDate + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` : '', r.cashier ? `Served by: ${r.cashier}` : ''].filter(Boolean), W / 2 + 20, y + 16);

  autoTable(doc, {
    startY: y + 70,
    head: [['#', 'Description', 'Unit', 'Qty', 'Unit price', 'Amount']],
    body: r.items.map((i, k) => [k + 1, i.name.replace(/ \((pack|carton of \d+)\)$/, ''), i.unit === 'carton' ? 'Carton' : (/carton/.test(i.name) ? 'Carton' : 'Pack'), i.qty, N(i.unit_price), N(i.qty * i.unit_price)]),
    styles: { fontSize: 10, cellPadding: 6 }, headStyles: { fillColor: [11, 122, 85], textColor: 255 },
    columnStyles: { 0: { cellWidth: 26 }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' } },
    margin: { left: 40, right: 40 },
  });
  y = doc.lastAutoTable.finalY + 16;
  const owed = r.total - r.amount_paid;
  const rows = [['Subtotal', N(r.subtotal)], ...(r.discount > 0 ? [['Discount', '-' + N(r.discount)]] : []), ...(r.porter > 0 ? [['Porter', N(r.porter)]] : []),
    ['Total', N(r.total)], ['Paid', N(r.amount_paid)], ['Balance due', N(owed)]];
  rows.forEach(([k, v], i) => {
    const bold = k === 'Total' || k === 'Balance due';
    doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(bold ? 12 : 10);
    doc.text(k, W - 220, y + i * 18); doc.text(v, W - 40, y + i * 18, { align: 'right' });
  });
  y += rows.length * 18 + 24;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(91, 102, 95);
  if (r.notes) { doc.text('Notes: ' + r.notes, 40, y, { maxWidth: W - 80 }); y += 28; }
  doc.text(owed > 0 ? 'Please pay the balance by the due date. Thank you for your business.' : 'Paid in full. Thank you for your business.', 40, y);
  doc.text(s.receipt_footer || '', 40, doc.internal.pageSize.getHeight() - 40);
  download(doc.output('blob'), `${no}.pdf`);
}
