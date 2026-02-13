/**
 * ARCHIVE-35 Order Log — Google Apps Script
 *
 * SETUP:
 * 1. Create a new Google Sheet (name it "Archive-35 Order Log")
 * 2. Create 3 tabs: "Orders", "Clients", "Issues"
 * 3. Open Extensions → Apps Script
 * 4. Paste this entire file
 * 5. Click Deploy → New Deployment → Web App
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 6. Copy the deployment URL
 * 7. Add to Cloudflare env: GOOGLE_SHEET_WEBHOOK_URL = <that URL>
 *
 * The webhook will POST order data here after every Stripe checkout.
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

const ORDERS_TAB = 'Orders';
const CLIENTS_TAB = 'Clients';
const ISSUES_TAB = 'Issues';

// Column headers for Orders tab (Row 1)
const ORDER_HEADERS = [
  'Order Date',        // A
  'Order Ref',         // B (Stripe session ID)
  'Order Type',        // C (print / license)
  'Status',            // D (completed / pending / issue)
  'Customer Name',     // E
  'Customer Email',    // F
  'Photo Title',       // G
  'Photo ID',          // H
  'Collection',        // I
  'Material',          // J
  'Size',              // K
  'Customer Paid',     // L
  'Stripe Fee',        // M (calculated: paid × 0.029 + 0.30)
  'Pictorem Cost',     // N
  'Your Profit',       // O (calculated: paid - fee - cost)
  'Ship To City',      // P
  'Ship To State',     // Q
  'Ship To Country',   // R
  'Ship To Address',   // S
  'Ship To Zip',       // T
  'Pictorem Order ID', // U
  'Pictorem Status',   // V
  'Image Source',      // W (r2-original / web-fallback)
  'Test Mode',         // X
  'Notes'              // Y
];

// Column headers for Clients tab (Row 1)
const CLIENT_HEADERS = [
  'Customer Name',     // A
  'Customer Email',    // B
  'First Order',       // C
  'Last Order',        // D
  'Total Orders',      // E
  'Total Spent',       // F
  'Ship To City',      // G
  'Ship To State',     // H
  'Ship To Country',   // I
  'Ship To Address',   // J
  'Ship To Zip',       // K
  'Notes'              // L
];

// Column headers for Issues tab (Row 1)
const ISSUE_HEADERS = [
  'Date',              // A
  'Order Ref',         // B
  'Customer Name',     // C
  'Customer Email',    // D
  'Issue Type',        // E (cancellation / return / quality / other)
  'Description',       // F
  'Status',            // G (open / resolved)
  'Resolution',        // H
  'Resolved Date'      // I
];

// ============================================================================
// WEB APP ENTRY POINT
// ============================================================================

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    // Initialize sheets if needed
    ensureHeaders();

    // Log the order
    logOrder(data);

    // Update client database
    updateClient(data);

    return ContentService.createTextOutput(JSON.stringify({
      success: true,
      timestamp: new Date().toISOString()
    })).setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({
      success: false,
      error: err.message
    })).setMimeType(ContentService.MimeType.JSON);
  }
}

// Also handle GET for testing
function doGet(e) {
  ensureHeaders();
  return ContentService.createTextOutput(JSON.stringify({
    status: 'Archive-35 Order Log is active',
    tabs: ['Orders', 'Clients', 'Issues'],
    timestamp: new Date().toISOString()
  })).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================================
// ENSURE HEADERS EXIST
// ============================================================================

function ensureHeaders() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();

  // Orders tab
  let ordersSheet = ss.getSheetByName(ORDERS_TAB);
  if (!ordersSheet) {
    ordersSheet = ss.insertSheet(ORDERS_TAB);
  }
  if (ordersSheet.getRange('A1').getValue() === '') {
    ordersSheet.getRange(1, 1, 1, ORDER_HEADERS.length).setValues([ORDER_HEADERS]);
    ordersSheet.getRange(1, 1, 1, ORDER_HEADERS.length)
      .setFontWeight('bold')
      .setBackground('#1a1a1a')
      .setFontColor('#c4973b')
      .setFontSize(10);
    ordersSheet.setFrozenRows(1);
    // Set column widths
    ordersSheet.setColumnWidth(1, 140);  // Date
    ordersSheet.setColumnWidth(2, 180);  // Ref
    ordersSheet.setColumnWidth(5, 160);  // Name
    ordersSheet.setColumnWidth(6, 220);  // Email
    ordersSheet.setColumnWidth(7, 200);  // Photo
  }

  // Clients tab
  let clientsSheet = ss.getSheetByName(CLIENTS_TAB);
  if (!clientsSheet) {
    clientsSheet = ss.insertSheet(CLIENTS_TAB);
  }
  if (clientsSheet.getRange('A1').getValue() === '') {
    clientsSheet.getRange(1, 1, 1, CLIENT_HEADERS.length).setValues([CLIENT_HEADERS]);
    clientsSheet.getRange(1, 1, 1, CLIENT_HEADERS.length)
      .setFontWeight('bold')
      .setBackground('#1a1a1a')
      .setFontColor('#c4973b')
      .setFontSize(10);
    clientsSheet.setFrozenRows(1);
  }

  // Issues tab
  let issuesSheet = ss.getSheetByName(ISSUES_TAB);
  if (!issuesSheet) {
    issuesSheet = ss.insertSheet(ISSUES_TAB);
  }
  if (issuesSheet.getRange('A1').getValue() === '') {
    issuesSheet.getRange(1, 1, 1, ISSUE_HEADERS.length).setValues([ISSUE_HEADERS]);
    issuesSheet.getRange(1, 1, 1, ISSUE_HEADERS.length)
      .setFontWeight('bold')
      .setBackground('#1a1a1a')
      .setFontColor('#c4973b')
      .setFontSize(10);
    issuesSheet.setFrozenRows(1);
  }
}

// ============================================================================
// LOG ORDER
// ============================================================================

function logOrder(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ORDERS_TAB);

  const paid = parseFloat(data.customerPaid) || 0;
  const stripeFee = Math.round((paid * 0.029 + 0.30) * 100) / 100;
  const pictoremCost = parseFloat(data.pictoremCost) || 0;
  const profit = Math.round((paid - stripeFee - pictoremCost) * 100) / 100;

  const row = [
    new Date().toISOString().split('T')[0] + ' ' + new Date().toTimeString().split(' ')[0], // Order Date
    data.orderRef || '',                    // Order Ref
    data.orderType || 'print',              // Order Type
    data.status || 'completed',             // Status
    data.customerName || '',                // Customer Name
    data.customerEmail || '',               // Customer Email
    data.photoTitle || '',                  // Photo Title
    data.photoId || '',                     // Photo ID
    data.collection || '',                  // Collection
    data.material || (data.orderType === 'license' ? data.licenseTier || '' : ''),  // Material / License Tier
    data.size || (data.orderType === 'license' ? data.resolution || '' : ''),        // Size / Resolution
    paid,                                   // Customer Paid
    stripeFee,                              // Stripe Fee
    pictoremCost,                           // Pictorem Cost
    profit,                                 // Your Profit
    data.shipCity || '',                    // Ship To City
    data.shipState || '',                   // Ship To State
    data.shipCountry || '',                 // Ship To Country
    data.shipAddress || '',                 // Ship To Address
    data.shipZip || '',                     // Ship To Zip
    data.pictoremOrderId || '',             // Pictorem Order ID
    data.pictoremStatus || '',              // Pictorem Status
    data.imageSource || '',                 // Image Source
    data.testMode ? 'TEST' : 'LIVE',       // Test Mode
    data.notes || ''                        // Notes
  ];

  sheet.appendRow(row);

  // Format currency columns
  const lastRow = sheet.getLastRow();
  sheet.getRange(lastRow, 12, 1, 4).setNumberFormat('$#,##0.00'); // L-O: money columns

  // Color code by order type
  if (data.orderType === 'license') {
    sheet.getRange(lastRow, 3).setBackground('#e8f5e9').setFontColor('#2e7d32'); // green
  } else {
    sheet.getRange(lastRow, 3).setBackground('#e3f2fd').setFontColor('#1565c0'); // blue
  }

  // Flag test mode
  if (data.testMode) {
    sheet.getRange(lastRow, 24).setBackground('#fff3e0').setFontColor('#e65100'); // orange
  }
}

// ============================================================================
// UPDATE CLIENT DATABASE
// ============================================================================

function updateClient(data) {
  if (!data.customerEmail) return;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CLIENTS_TAB);
  const allData = sheet.getDataRange().getValues();

  const email = data.customerEmail.toLowerCase().trim();
  const paid = parseFloat(data.customerPaid) || 0;
  const today = new Date().toISOString().split('T')[0];

  // Search for existing client by email (column B = index 1)
  let existingRow = -1;
  for (let i = 1; i < allData.length; i++) {
    if (allData[i][1] && allData[i][1].toString().toLowerCase().trim() === email) {
      existingRow = i + 1; // 1-indexed for Sheets
      break;
    }
  }

  if (existingRow > 0) {
    // Update existing client
    const currentOrders = parseInt(sheet.getRange(existingRow, 5).getValue()) || 0;
    const currentSpent = parseFloat(sheet.getRange(existingRow, 6).getValue()) || 0;

    sheet.getRange(existingRow, 4).setValue(today);                        // Last Order
    sheet.getRange(existingRow, 5).setValue(currentOrders + 1);            // Total Orders
    sheet.getRange(existingRow, 6).setValue(currentSpent + paid);          // Total Spent
    sheet.getRange(existingRow, 6).setNumberFormat('$#,##0.00');

    // Update address if provided (newer is better)
    if (data.shipCity) sheet.getRange(existingRow, 7).setValue(data.shipCity);
    if (data.shipState) sheet.getRange(existingRow, 8).setValue(data.shipState);
    if (data.shipCountry) sheet.getRange(existingRow, 9).setValue(data.shipCountry);
    if (data.shipAddress) sheet.getRange(existingRow, 10).setValue(data.shipAddress);
    if (data.shipZip) sheet.getRange(existingRow, 11).setValue(data.shipZip);

    // Update name if we have a better one
    if (data.customerName && data.customerName.length > 1) {
      sheet.getRange(existingRow, 1).setValue(data.customerName);
    }
  } else {
    // New client
    const row = [
      data.customerName || '',               // Customer Name
      data.customerEmail || '',              // Customer Email
      today,                                 // First Order
      today,                                 // Last Order
      1,                                     // Total Orders
      paid,                                  // Total Spent
      data.shipCity || '',                   // Ship To City
      data.shipState || '',                  // Ship To State
      data.shipCountry || '',                // Ship To Country
      data.shipAddress || '',                // Ship To Address
      data.shipZip || '',                    // Ship To Zip
      ''                                     // Notes
    ];
    sheet.appendRow(row);
    const lastRow = sheet.getLastRow();
    sheet.getRange(lastRow, 6).setNumberFormat('$#,##0.00');
  }
}

// ============================================================================
// MANUAL: LOG AN ISSUE (call from sheet or script)
// ============================================================================

function logIssue(orderRef, customerName, customerEmail, issueType, description) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(ISSUES_TAB);

  sheet.appendRow([
    new Date().toISOString().split('T')[0],  // Date
    orderRef,                                 // Order Ref
    customerName,                             // Customer Name
    customerEmail,                            // Customer Email
    issueType,                                // Issue Type
    description,                              // Description
    'open',                                   // Status
    '',                                       // Resolution
    ''                                        // Resolved Date
  ]);
}
