# Customer List Extractor (Chrome / Edge sidebar extension)

Collects the filtered **CRM → Customers** list (for example Status **Expired** +
Connection **No internet**) from **every page** and shows it in a sidebar with
**Username, Phone, Package and Expiry**. You can sort it, copy it and share it.

## Install (one time)
1. Open `chrome://extensions` (or `edge://extensions`).
2. Turn on **Developer mode**.
3. Click **Load unpacked** and pick this `customer-extractor` folder.
4. Pin the extension and click its icon. The sidebar opens.

## Use
1. Go to CRM → Customers and set the filters (Status: Expired, Connection: No internet).
2. Click **Scan all pages**. It goes back to page 1, pages through to the last page and
   collects every row. When it finishes it checks the count against the "(N total)" in the header.
3. Sort by clicking a column header (Username, Phone, Package, Expiry). Click again to reverse it.
   The default is the oldest expiry first.
4. Narrow the list with the Status / Connection / Package dropdowns or the search box.
5. Share it:
   - **Copy list**: a numbered list ready to paste into WhatsApp or email
   - **Copy for Excel**: paste straight into Excel or Google Sheets
   - **Download CSV**

Options: phone format (2547…, 07…, +254…), include the customer name, and show the expiry with or without the time.

## Why it doesn't mix up fields
Columns are matched by the table's header ids (`header-username`, `header-phone`,
`header-package`, `header-expiry`…), not by position, so hiding or reordering columns
can't put a value in the wrong field. Rows are de-duplicated by username across pages,
and the sidebar warns you if a page doesn't load or the total doesn't match.

Tip: setting the table to show more rows per page (⚙ preferences) makes the scan faster.
