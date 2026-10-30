import { Platform } from 'react-native';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
// The plain "expo-file-system" import now only exposes the new File/
// Directory class API — the old function-style calls below (getInfoAsync,
// writeAsStringAsync, cacheDirectory, EncodingType) throw at runtime from
// there. "expo-file-system/legacy" still has the real, working versions.
import * as FileSystem from 'expo-file-system/legacy';
import * as XLSX from 'xlsx';

function formatTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(minutes) {
  if (!minutes) return '—';
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function buildHtml({ companyName, fromDate, toDate, records }) {
  const totalDays = new Set(records.map((r) => `${r.employee_id}_${r.date}`)).size;
  const totalMinutes = records.reduce((sum, r) => sum + (r.duration_minutes || 0), 0);
  const totalHours = (totalMinutes / 60).toFixed(1);
  const presentCount = records.filter((r) => r.check_in || r.status === 'present' || r.status === 'half_day').length;
  const attendancePercentage = totalDays > 0 ? Math.round((presentCount / totalDays) * 100) : 0;

  const rows = records
    .map(
      (r) => `
      <tr>
        <td>${r.employee_name}</td>
        <td>${r.date}</td>
        <td>${formatTime(r.check_in)}</td>
        <td>${formatTime(r.check_out)}</td>
        <td>${formatDuration(r.duration_minutes)}</td>
        <td>${r.status || (r.check_in ? 'present' : '—')}</td>
      </tr>`
    )
    .join('');

  return `
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          body { font-family: -apple-system, Helvetica, Arial, sans-serif; padding: 24px; color: #1a1a2e; }
          h1 { font-size: 20px; margin-bottom: 4px; }
          .subtitle { color: #6c757d; font-size: 12px; margin-bottom: 20px; }
          table { width: 100%; border-collapse: collapse; font-size: 12px; }
          th, td { border: 1px solid #ced4da; padding: 6px 8px; text-align: left; }
          th { background: #f8f9fa; }
          .footer { margin-top: 20px; font-size: 12px; color: #343a40; }
        </style>
      </head>
      <body>
        <h1>${companyName}</h1>
        <div class="subtitle">Attendance Report — ${fromDate} to ${toDate}</div>
        <table>
          <thead>
            <tr>
              <th>Employee</th><th>Date</th><th>Check-In</th><th>Check-Out</th><th>Duration</th><th>Status</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="6">No records in this range.</td></tr>'}</tbody>
        </table>
        <div class="footer">
          Total records: ${records.length} &nbsp;|&nbsp; Total hours: ${totalHours} &nbsp;|&nbsp; Attendance: ${attendancePercentage}%
        </div>
      </body>
    </html>
  `;
}

export async function generatePdfReport({ companyName, fromDate, toDate, records }) {
  const html = buildHtml({ companyName, fromDate, toDate, records });

  // expo-print's file-writing API isn't available in a browser — the web
  // equivalent is opening the report in a new tab and letting the browser's
  // own print dialog save it as a PDF ("Save as PDF" is a built-in option
  // in every mobile/desktop browser's print sheet).
  if (Platform.OS === 'web') {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      throw new Error('Please allow pop-ups to generate the PDF report.');
    }
    printWindow.document.write(html);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 300);
    return { uri: null, size: 0, web: true };
  }

  const { uri } = await Print.printToFileAsync({ html });
  const info = await FileSystem.getInfoAsync(uri);
  return { uri, size: info.size };
}

export async function generateExcelReport({ fromDate, toDate, records }) {
  const rows = records.map((r) => ({
    Date: r.date,
    'Employee Name': r.employee_name,
    'Check-In': formatTime(r.check_in),
    'Check-Out': formatTime(r.check_out),
    'Duration (hrs)': r.duration_minutes ? (r.duration_minutes / 60).toFixed(2) : '',
    Status: r.status || (r.check_in ? 'present' : ''),
  }));

  const worksheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Attendance');
  const fileName = `attendance_${fromDate}_to_${toDate}.xlsx`;

  // expo-file-system has no real filesystem to write to on web (its
  // cacheDirectory is null there) — the web equivalent is building the
  // file in memory and triggering a normal browser download.
  if (Platform.OS === 'web') {
    const wbout = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
    const blob = new Blob([wbout], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    return { uri: null, size: blob.size, web: true };
  }

  const base64 = XLSX.write(workbook, { type: 'base64', bookType: 'xlsx' });
  const uri = `${FileSystem.cacheDirectory}${fileName}`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  const info = await FileSystem.getInfoAsync(uri);
  return { uri, size: info.size };
}

export async function shareFile(uri) {
  // On web, generatePdfReport/generateExcelReport already triggered the
  // print dialog or download directly — there's no separate native share
  // sheet to open, and no uri to share even if there were.
  if (Platform.OS === 'web' || !uri) return;

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(uri);
}

