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
