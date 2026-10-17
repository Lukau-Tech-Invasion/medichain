//! PDF generation (Phase 13.3).
//!
//! A small wrapper over `printpdf` that renders a titled, sectioned A4 document
//! from plain text. The frontend already holds the formatted content for lab
//! results, prescriptions, visit summaries and discharge instructions, so a
//! single generic `render_document` + `POST /api/pdf/document` endpoint powers
//! every "Export as PDF" button without coupling the PDF layer to each domain
//! repository.

use printpdf::{BuiltinFont, Mm, PdfDocument};

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

/// Render a titled, sectioned document to PDF bytes.
///
/// Lays text top-to-bottom, adding pages as needed. Returns the encoded PDF or a
/// human-readable error string.
pub fn render_document(
    title: &str,
    subtitle: Option<&str>,
    sections: &[PdfSection],
) -> Result<Vec<u8>, String> {
    let (doc, page1, layer1) = PdfDocument::new(title, Mm(PAGE_W), Mm(PAGE_H), "Layer 1");
    let font = doc
        .add_builtin_font(BuiltinFont::Helvetica)
        .map_err(|e| format!("font load failed: {e}"))?;
    let font_bold = doc
        .add_builtin_font(BuiltinFont::HelveticaBold)
        .map_err(|e| format!("font load failed: {e}"))?;

    let mut layer = doc.get_page(page1).get_layer(layer1);
    let mut y = PAGE_H - MARGIN;

    // Helper to start a new page when we run out of vertical space.
    let new_page_if_needed = |doc: &printpdf::PdfDocumentReference,
                              layer: &mut printpdf::PdfLayerReference,
                              y: &mut f32,
                              needed: f32| {
        if *y - needed < BOTTOM {
            let (p, l) = doc.add_page(Mm(PAGE_W), Mm(PAGE_H), "Layer");
            *layer = doc.get_page(p).get_layer(l);
            *y = PAGE_H - MARGIN;
        }
    };

    // Title + subtitle.
    for line in wrapped_lines(title, 18.0, PAGE_W - 2.0 * MARGIN) {
        new_page_if_needed(&doc, &mut layer, &mut y, 8.0);
        layer.use_text(line, 18.0, Mm(MARGIN), Mm(y), &font_bold);
        y -= 8.0;
    }
    if let Some(sub) = subtitle {
        for line in wrapped_lines(sub, 11.0, PAGE_W - 2.0 * MARGIN) {
            new_page_if_needed(&doc, &mut layer, &mut y, 6.0);
            layer.use_text(line, 11.0, Mm(MARGIN), Mm(y), &font);
            y -= 6.0;
        }
    }
    new_page_if_needed(&doc, &mut layer, &mut y, 10.0);
    layer.use_text(
        format!(
            "Generated: {}",
            chrono::Utc::now().format("%Y-%m-%d %H:%M UTC")
        ),
        9.0,
        Mm(MARGIN),
        Mm(y),
        &font,
    );
    y -= 10.0;

    for section in sections {
        new_page_if_needed(&doc, &mut layer, &mut y, 10.0);
        for heading in wrapped_lines(&section.heading, 13.0, PAGE_W - 2.0 * MARGIN) {
            new_page_if_needed(&doc, &mut layer, &mut y, 7.0);
            layer.use_text(heading, 13.0, Mm(MARGIN), Mm(y), &font_bold);
            y -= 7.0;
        }
        for line in &section.lines {
            for wrapped in wrapped_lines(line, 10.0, PAGE_W - 2.0 * MARGIN - 3.0) {
                new_page_if_needed(&doc, &mut layer, &mut y, 6.0);
                layer.use_text(wrapped, 10.0, Mm(MARGIN + 3.0), Mm(y), &font);
                y -= 5.5;
            }
        }
        y -= 4.0;
    }

    let mut buf = std::io::BufWriter::new(Vec::<u8>::new());
    doc.save(&mut buf)
        .map_err(|e| format!("pdf save failed: {e}"))?;
    buf.into_inner()
        .map_err(|e| format!("pdf buffer error: {e}"))
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
}
