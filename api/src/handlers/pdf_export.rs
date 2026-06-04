//! PDF export endpoint (Phase 13.3). Inherits shared imports via `use super::*`.

use super::*;

#[derive(Debug, Deserialize)]
pub struct PdfSectionInput {
    pub heading: String,
    #[serde(default)]
    pub lines: Vec<String>,
}

#[derive(Debug, Deserialize)]
pub struct PdfDocumentRequest {
    pub title: String,
    #[serde(default)]
    pub subtitle: Option<String>,
    #[serde(default)]
    pub sections: Vec<PdfSectionInput>,
    /// Optional download filename (without extension).
    #[serde(default)]
    pub filename: Option<String>,
}

/// Generate a PDF from a titled, sectioned document and return it as
/// `application/pdf`. Powers every "Export as PDF" button (lab results,
/// prescriptions, visit summaries, discharge instructions).
///
/// POST /api/pdf/document
#[post("/api/pdf/document")]
pub async fn export_pdf_document(
    req: HttpRequest,
    body: web::Json<PdfDocumentRequest>,
) -> impl Responder {
    if get_current_user_id(&req).is_none() {
        return HttpResponse::Unauthorized().json(ErrorResponse {
            success: false,
            error: "Authentication required".to_string(),
            code: "UNAUTHORIZED".to_string(),
        });
    }

    let sections: Vec<crate::pdf::PdfSection> = body
        .sections
        .iter()
        .map(|s| crate::pdf::PdfSection {
            heading: s.heading.clone(),
            lines: s.lines.clone(),
        })
        .collect();

    match crate::pdf::render_document(&body.title, body.subtitle.as_deref(), &sections) {
        Ok(bytes) => {
            let filename = body
                .filename
                .clone()
                .unwrap_or_else(|| "medichain-document".to_string());
            HttpResponse::Ok()
                .content_type("application/pdf")
                .insert_header((
                    "Content-Disposition",
                    format!("attachment; filename=\"{}.pdf\"", filename),
                ))
                .body(bytes)
        }
        Err(e) => HttpResponse::InternalServerError().json(ErrorResponse {
            success: false,
            error: e,
            code: "PDF_RENDER_ERROR".to_string(),
        }),
    }
}
