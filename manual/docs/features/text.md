---
sidebar_position: 4
title: Text and codes
description: Write text with any font, put text on a path, use variable text and serial numbers, and create QR codes and barcodes.
---

# Text and codes

## Writing text

Choose the **Text** tool (Ctrl+T) and click on the workspace to start typing. Drag a box instead of clicking to get a text box with word wrap. Click an existing text to edit it.

The **text toolbar** below the numeric edits toolbar holds all text options: font, height, bold, italic, upper case, letter and line spacing, alignment, maximum width and height, weld, text on path and variable text.

![A sign with a headline and a text box with word wrap; the text box is selected, and the text toolbar shows its font, a height of 11 mm, centred alignment, the line spacing, a maximum width of 240 mm and the active Wrap button](/img/text-toolbar-en.webp)

| Option | What it does |
|---|---|
| **Weld** | Merges overlapping letters into one outline, for script fonts or tight letter spacing. |
| **Wrap** / **Max width** | Breaks lines at word boundaries at the box width; the box grows downward. Dragging the side handles reflows the text. |
| **Max. height** | Scales a block that gets too tall down evenly. |
| **Shrink** | Scales a text that is too wide down instead of condensing it. |

Text stays editable. **Convert to Path** (Ctrl+Shift+C) turns it into its real font outlines, for example before node editing.

## Fonts

All fonts installed on your computer can be used. **File → Fonts …** (or **More fonts …** at the end of the font list) opens the font manager:

- Search all Google Fonts with a live preview of your own sample text, filter by kind and sort by popularity or name.
- **Install** downloads the font into KizamuBeam, so it works offline and without installing it in the system. **Use** applies it to the selected text.
- Import your own TTF or OTF files the same way.
- Star a font to make it a favourite; favourites appear at the top of the font list.

When a project uses a font that is missing on this computer, KizamuBeam offers to download it from Google Fonts.

## Text on a path

Select a text and a shape, then choose **Tools → Text Functions → Apply Path to Text** (or **On Path** in the text toolbar). The text follows the line, curve, rectangle, ellipse or polygon. In the text toolbar you set the offset along the curve, the distance from the curve and which side the text is on.

![Text on a path: one lettering follows a circle inside a round badge, a second text follows a wavy line; both guide shapes lie on the tool layer T1, and for the selected text the text toolbar shows Offset, Distance, Flip and Remove Path](/img/text-on-path-en.webp)

Text and shape stay linked: if you edit or move the shape, the text follows. The shape is lasered too, unless it is on a tool layer (T1/T2) or hidden. **Tools → Text Functions → Remove Path from Text** separates them again.

## Variable text and serial numbers

Variable text fills in placeholders when the job is created, for serial numbers, dates or names from a list. Turn on **Variable** in the text toolbar and use these placeholders:

| Placeholder | Becomes |
|---|---|
| `%#` | Serial number; `%4#` with leading zeros (`0042`) |
| `%d.%m.%Y`, `%H:%M` … | Date and time |
| `%0`, `%1` … or `%{Header}` | Column of a CSV file (comma, semicolon or tab separated) |

The **Variable Text** window (**Tools → Text Functions → Variable Text …**) sets the current number, start, end, step and whether it advances automatically after every job or saved G-code file. The number is also the row of the CSV file. Each object can have its own offset, so one page can hold several consecutive numbers.

![Variable Text window with the current number 42, start, end, a step size of 4 and auto-advance; the list below shows how the placeholders of this page become Serial no. 0042 to 0045 and the date, as on the four rating plates on the workspace](/img/variable-text-en.webp)

**Bake Variable Text** turns the current content into fixed text.

### Batch proof

Before a series runs, **Batch Proof** (Toolbox, **Tools → Text Functions → Batch Proof …**, or the button in the **Variable Text** window) shows every piece on its own: its number, the piece drawn the way it would be engraved, the content that was filled in, and what is wrong with it.

It reports an empty field, a row or a column the CSV file does not have, an instruction the customer left in the name, emoji and invisible characters, characters the chosen font does not have, and the same piece twice. **Show** puts that number on the workspace. Set the range with **From** and **to**; **Only pieces with problems** hides the rest. Before a job starts, the same check runs for the numbers that job uses, together with the design check — saving a G-code or `.rd` file counts as a start, because it uses up numbers too. **Settings → Laser → Check before lasering and ask if there are problems** switches both off.

![Batch Proof window for name tags from a CSV file, showing the five pieces with problems out of seven: each row has the number, the name and order number drawn as outlines the way they would be engraved, the filled-in content and the findings — an empty field at number 2, a customer instruction at 3, an emoji at 4, characters missing from the font at 5 and the same content twice at 6](/img/batch-proof-en.webp)

For a whole series of pages from a table, see [Templates and library](templates-library.md#series-from-a-table).

## QR codes

Open **QR code** in the Toolbox (or search for it there). Double-click an existing QR code to edit it. A QR code can contain:

- text or a web address,
- Wi-Fi access data,
- a contact card (vCard).

Choose the error correction (L, M, Q, H) and the size in mm. **Negative Image** lasers the background including the quiet zone, for dark materials. The modules are merged into closed outlines, so put the code on a **Fill** layer to engrave it. Double-click a QR code to edit it.

![Create QR code dialog: type Text / web address with a web address as content, error correction M, a size of 30 mm, the options for a negative image and for variable text, and the preview of the code](/img/qr-code-dialog-en.webp)

## Barcodes

**Toolbox → Text and Data → Barcode** creates Code 128, EAN-13, EAN-8, UPC-A, Code 39 and ITF barcodes, with check digits where the format uses them. Set the width and bar height, show the human-readable text below the bars, and reduce the bar width to make up for the beam width. **Negative Image** lasers the gaps instead of the bars. The dialog warns when bars get too narrow for the laser.

![Create Barcode dialog: type Code 128 with the content SN-2026-0042, width 40 mm, height 15 mm, human-readable text below the bars, bar width reduction and the options for a negative image and variable text; the preview shows the barcode, with modules of 0.256 mm](/img/barcode-dialog-en.webp)

QR codes and barcodes accept variable text and project parameters too, for example a serial number as Code 128.
