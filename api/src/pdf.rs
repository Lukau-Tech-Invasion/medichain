//! PDF generation (Phase 13.3).
//!
//! A small wrapper over `printpdf` that renders a titled, sectioned A4 document
//! from plain text. The frontend already holds the formatted content for lab
//! results, prescriptions, visit summaries and discharge instructions, so a
//! single generic `render_document` + `POST /api/pdf/document` endpoint powers
//! every "Export as PDF" button without coupling the PDF layer to each domain
//! repository.

use printpdf::{
    BuiltinFont, Mm, Op, PdfDocument, PdfFontHandle, PdfPage, PdfSaveOptions, Point, Pt, TextItem,
};

/// A labelled block of lines in the document.
pub struct PdfSection {
    pub heading: String,
    pub lines: Vec<String>,
}

const PAGE_W: f32 = 210.0; // A4 width (mm)
const PAGE_H: f32 = 297.0; // A4 height (mm)
const MARGIN: f32 = 15.0;
const BOTTOM: f32 = 15.0;

/// Split supplied text into bounded lines, preserving characters and explicit newlines.
/// The conservative character bound allows for wide Helvetica glyphs at each size.
fn wrapped_lines(text: &str, font_size: f32, width_mm: f32) -> Vec<String> {
    let limit = ((width_mm * 72.0 / 25.4) / (font_size * 1.1)).floor() as usize;
    let limit = limit.max(1);
    text.split('\n')
        .flat_map(|line| {
            let chars: Vec<char> = line.trim_end_matches('\r').chars().collect();
            if chars.is_empty() {
                return vec![String::new()];
            }
            let mut lines = Vec::new();
            let mut start = 0;
            while start < chars.len() {
                let end = (start + limit).min(chars.len());
                let boundary = if end < chars.len() {
                    chars[start..end]
                        .iter()
                        .rposition(|ch| ch.is_whitespace())
                        .map(|position| start + position + 1)
                        .unwrap_or(end)
                } else {
                    end
                };
                lines.push(chars[start..boundary].iter().collect());
                start = boundary;
            }
            lines
        })
        .collect()
}

/// Text laid top-to-bottom across as many A4 pages as it needs.
struct Layout {
    finished: Vec<PdfPage>,
    ops: Vec<Op>,
    y: f32,
}

impl Layout {
    fn new() -> Self {
        Self {
            finished: Vec::new(),
            ops: Vec::new(),
            y: PAGE_H - MARGIN,
        }
    }

    /// Start a new page when `needed` millimetres no longer fit on this one.
    fn reserve(&mut self, needed: f32) {
        if self.y - needed < BOTTOM {
            let ops = std::mem::take(&mut self.ops);
            self.finished
                .push(PdfPage::new(Mm(PAGE_W), Mm(PAGE_H), ops));
            self.y = PAGE_H - MARGIN;
        }
    }

    /// One line of text at the current height, then move down by `advance`.
    fn line(&mut self, text: String, font: BuiltinFont, size: f32, indent: f32, advance: f32) {
        self.ops.extend([
            Op::StartTextSection,
            Op::SetTextCursor {
                pos: Point::new(Mm(MARGIN + indent), Mm(self.y)),
            },
            Op::SetFont {
                font: PdfFontHandle::Builtin(font),
                size: Pt(size),
            },
            Op::ShowText {
                items: vec![TextItem::Text(text)],
            },
            Op::EndTextSection,
        ]);
        self.y -= advance;
    }

    fn into_pages(mut self) -> Vec<PdfPage> {
        self.finished
            .push(PdfPage::new(Mm(PAGE_W), Mm(PAGE_H), self.ops));
        self.finished
    }
}

/// Render a titled, sectioned document to PDF bytes.
///
/// Lays text top-to-bottom, adding pages as needed. Returns the encoded PDF or a
/// human-readable error string.
pub fn render_document(
    title: &str,
    subtitle: Option<&str>,
    sections: &[PdfSection],
) -> Result<Vec<u8>, String> {
    let width = PAGE_W - 2.0 * MARGIN;
    let mut page = Layout::new();

    for line in wrapped_lines(title, 18.0, width) {
        page.reserve(8.0);
        page.line(line, BuiltinFont::HelveticaBold, 18.0, 0.0, 8.0);
    }
    for line in subtitle
        .map(|sub| wrapped_lines(sub, 11.0, width))
        .unwrap_or_default()
    {
        page.reserve(6.0);
        page.line(line, BuiltinFont::Helvetica, 11.0, 0.0, 6.0);
    }
    page.reserve(10.0);
    let generated = format!(
        "Generated: {}",
        chrono::Utc::now().format("%Y-%m-%d %H:%M UTC")
    );
    page.line(generated, BuiltinFont::Helvetica, 9.0, 0.0, 10.0);

    for section in sections {
        page.reserve(10.0);
        for heading in wrapped_lines(&section.heading, 13.0, width) {
            page.reserve(7.0);
            page.line(heading, BuiltinFont::HelveticaBold, 13.0, 0.0, 7.0);
        }
        for line in &section.lines {
            for wrapped in wrapped_lines(line, 10.0, width - 3.0) {
                page.reserve(6.0);
                page.line(wrapped, BuiltinFont::Helvetica, 10.0, 3.0, 5.5);
            }
        }
        page.y -= 4.0;
    }

    let mut doc = PdfDocument::new(title);
    doc.with_pages(page.into_pages());
    let mut warnings = Vec::new();
    let bytes = doc.save(&PdfSaveOptions::default(), &mut warnings);
    if bytes.is_empty() {
        return Err("pdf save produced no bytes".to_string());
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn long_report_text_and_unbroken_identifiers_fit_without_losing_characters() {
        let text = "Wide WWWWWW narrative and synthetic identifier ".repeat(12);
        let lines = wrapped_lines(&text, 10.0, 177.0);
        assert!(lines.len() > 1);
        assert!(lines.iter().all(|line| line.chars().count() <= 45));
        assert_eq!(lines.concat(), text);
        let unicode = "患者é".repeat(50);
        assert_eq!(wrapped_lines(&unicode, 10.0, 177.0).concat(), unicode);
    }

    #[test]
    fn renders_a_valid_pdf_header() {
        let sections = vec![PdfSection {
            heading: "Results".to_string(),
            lines: vec!["Hemoglobin: 13.5 g/dL".to_string(); 80], // forces a page break
        }];
        let bytes = render_document("Lab Report", Some("Patient: MCHI-2026-0001"), &sections)
            .expect("pdf renders");
        // Every PDF starts with the "%PDF" magic bytes.
        assert_eq!(&bytes[0..4], b"%PDF");
        assert!(bytes.len() > 1000);
    }

    #[test]
    fn eighty_lines_spill_onto_a_second_page() {
        let mut page = Layout::new();
        for n in 0..80 {
            page.reserve(6.0);
            page.line(format!("line {n}"), BuiltinFont::Helvetica, 10.0, 0.0, 5.5);
        }
        assert_eq!(page.into_pages().len(), 2);
    }
}
