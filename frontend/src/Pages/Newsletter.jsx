import React, { useState, useEffect, useCallback } from "react";
import { apiFetch } from "../api";
import {
  Box, Card, CardContent, Typography, Chip,
  Stack, CircularProgress, IconButton, Tooltip,
  TextField, InputAdornment, useTheme, useMediaQuery,
} from "@mui/material";
import ArticleIcon        from "@mui/icons-material/Article";
import AutoAwesomeIcon    from "@mui/icons-material/AutoAwesome";
import CalendarTodayIcon  from "@mui/icons-material/CalendarToday";
import ContentCopyIcon    from "@mui/icons-material/ContentCopy";
import CheckIcon          from "@mui/icons-material/Check";
import ChevronLeftIcon    from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon   from "@mui/icons-material/ChevronRight";
import ExpandLessIcon     from "@mui/icons-material/ExpandLess";
import ExpandMoreIcon     from "@mui/icons-material/ExpandMore";
import DeleteOutlineIcon  from "@mui/icons-material/DeleteOutline";
import CloseIcon          from "@mui/icons-material/Close";
import { useAppTheme }    from "../AppThemeContext";

const API_BASE    = import.meta.env.VITE_API_BASE_URL || "http://localhost:8000";
const SIDEBAR_KEY = "TrendSense_newsletter_sidebar_open";

// ── Static newsletter copy — Tzunami branding ────────────────────────────────
const CTA_URL = "https://cloudsfer.com/contact-us/";

const SOCIAL_LINKS = [
  { name: "Facebook", url: "https://www.facebook.com/TzunamiDeployer?locale=he_IL", icon: "https://cdn-images.mailchimp.com/icons/social-block-v2/color-facebook-48.png" },
  { name: "X",        url: "https://twitter.com/tzunami",                           icon: "https://cdn-images.mailchimp.com/icons/social-block-v2/color-twitter-48.png" },
  { name: "Website",  url: "https://tzunami.com/",                                  icon: "https://cdn-images.mailchimp.com/icons/social-block-v2/color-link-48.png" },
  { name: "LinkedIn", url: "https://www.linkedin.com/company/126996/admin/feed/posts/", icon: "https://cdn-images.mailchimp.com/icons/social-block-v2/color-linkedin-48.png" },
];

const FOOTER_COPYRIGHT = "Copyright ©️ 2024 Tzunami Inc. All rights reserved.";
const FOOTER_ADDRESS   = "support@tzunami.com";
const FOOTER_PREFS_URL = "#";
const FOOTER_UNSUB_URL = "#";

const PROVIDER_COLORS = {
  openai:    "#10a37f",
  anthropic: "#d97757",
  gemini:    "#4285f4",
};

// ── Build Mailchimp-compatible inline-styled HTML for Gmail paste ──────────────
function buildGmailHtml(newsletter) {
  const c        = newsletter?.content || {};
  const hook     = String(c.hook_paragraph || "");
  const stat     = String(c.stat_paragraph || "");
  const source   = String(c.source_name || "");
  const sourceUrl= String(c.source_url || "#");
  const highlight= String(c.highlight_stat || "");
  const context  = String(c.context_paragraph || "");
  const solution = String(c.solution_paragraph || "");
  const ctaLabel = String(c.cta_label || "👉 Request a Free Demo");
  const imageData= String(c.image_data || "");

  const esc = (s) => s.replace(/</g, "&lt;").replace(/>/g, "&gt;");

  // Replace **stat** in stat_paragraph with red-highlighted version
  const highlightStat = (text, stat) => {
    if (!stat) return `<span style="font-size:18px">${esc(text)}</span>`;
    const escaped = stat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const parts = text.split(new RegExp(`(${escaped})`, 'i'));
    return parts.map(p => {
      if (p.toLowerCase() === stat.toLowerCase()) {
        return `<span style="color:#B22222;font-weight:bold;">${esc(p)}</span>`;
      }
      return `<span style="font-size:18px">${esc(p)}</span>`;
    }).join('');
  };

  // Build social icons HTML
  const socialIconsHtml = SOCIAL_LINKS.map(s => `
    <td align="center" valign="top" style="mso-line-height-rule:exactly;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;">
      <!--[if mso]><td align="center" valign="top"><![endif]-->
      <table align="left" border="0" cellpadding="0" cellspacing="0" style="display:inline;border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;float:left;">
        <tr>
          <td valign="top" style="padding-right:10px;padding-bottom:9px;mso-line-height-rule:exactly;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;">
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;">
              <tr>
                <td align="left" valign="middle" style="padding-top:5px;padding-right:10px;padding-bottom:5px;padding-left:9px;mso-line-height-rule:exactly;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;">
                  <table align="left" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;float:left;">
                    <tr>
                      <td align="center" valign="middle" width="24" style="mso-line-height-rule:exactly;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;">
                        <a href="${esc(s.url)}" target="_blank" style="mso-line-height-rule:exactly;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;"><img src="${esc(s.icon)}" alt="${esc(s.name)}" style="display:block;border:0;height:auto;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;" height="24" width="24"></a>
                      </td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
      <!--[if mso]></td><![endif]-->
    </td>`).join('');

  // Image section (only if imageData exists)
  const imageSection = imageData
    ? `<p dir="ltr" style="color:#222222;margin:10px 0;padding:0;mso-line-height-rule:exactly;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;font-family:Helvetica;font-size:16px;line-height:150%;text-align:left;"><img src="data:image/png;base64,${imageData}" style="border:0;width:600px;height:auto;margin:0;outline:none;text-decoration:none;-ms-interpolation-mode:bicubic;" width="600"></p>`
    : '';

  return `
<!doctype html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${esc(newsletter.title || 'Tzunami Newsletter')}</title>
    <style type="text/css">
      p{margin:10px 0;padding:0;}
      table{border-collapse:collapse;}
      h1,h2,h3,h4,h5,h6{display:block;margin:0;padding:0;}
      img,a img{border:0;height:auto;outline:none;text-decoration:none;}
      body,#bodyTable,#bodyCell{height:100%;margin:0;padding:0;width:100%;}
      .mcnPreviewText{display:none !important;}
      #outlook a{padding:0;}
      img{-ms-interpolation-mode:bicubic;}
      table{mso-table-lspace:0pt;mso-table-rspace:0pt;}
      .ReadMsgBody{width:100%;}
      .ExternalClass{width:100%;}
      p,a,li,td,blockquote{mso-line-height-rule:exactly;}
      a[href^=tel],a[href^=sms]{color:inherit;cursor:default;text-decoration:none;}
      p,a,li,td,body,table,blockquote{-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;}
      .ExternalClass,.ExternalClass p,.ExternalClass td,.ExternalClass div,.ExternalClass span,.ExternalClass font{line-height:100%;}
      a[x-apple-data-detectors]{color:inherit !important;text-decoration:none !important;font-size:inherit !important;font-family:inherit !important;font-weight:inherit !important;line-height:inherit !important;}
      .templateContainer{max-width:600px !important;}
      a.mcnButton{display:block;}
      .mcnImage,.mcnRetinaImage{vertical-align:bottom;}
      .mcnTextContent{word-break:break-word;}
      .mcnTextContent img{height:auto !important;}
      .mcnDividerBlock{table-layout:fixed !important;}
      h1{color:#222222;font-family:Helvetica;font-size:40px;font-style:normal;font-weight:bold;line-height:150%;letter-spacing:normal;text-align:left;}
      h2{color:#222222;font-family:Helvetica;font-size:28px;font-style:normal;font-weight:bold;line-height:150%;letter-spacing:normal;text-align:left;}
      h3{color:#444444;font-family:Helvetica;font-size:22px;font-style:normal;font-weight:bold;line-height:150%;letter-spacing:normal;text-align:left;}
      h4{color:#949494;font-family:Georgia;font-size:20px;font-style:italic;font-weight:normal;line-height:125%;letter-spacing:normal;text-align:left;}
      #templateHeader{background-color:#F7F7F7;background-image:none;background-repeat:no-repeat;background-position:50% 50%;background-size:cover;border-top:0;border-bottom:0;padding-top:0px;padding-bottom:0px;}
      .headerContainer{background-color:transparent;background-image:none;background-repeat:no-repeat;background-position:center;background-size:cover;border-top:0;border-bottom:0;padding-top:0;padding-bottom:0;}
      .headerContainer .mcnTextContent,.headerContainer .mcnTextContent p{color:#757575;font-family:Helvetica;font-size:16px;line-height:150%;text-align:left;}
      .headerContainer .mcnTextContent a,.headerContainer .mcnTextContent p a{color:#007C89;font-weight:normal;text-decoration:underline;}
      #templateBody{background-color:#FFFFFF;background-image:none;background-repeat:no-repeat;background-position:center;background-size:cover;border-top:0;border-bottom:0;padding-top:66px;padding-bottom:66px;}
      .bodyContainer{background-color:transparent;background-image:none;background-repeat:no-repeat;background-position:center;background-size:cover;border-top:0;border-bottom:0;padding-top:0;padding-bottom:0;}
      .bodyContainer .mcnTextContent,.bodyContainer .mcnTextContent p{color:#757575;font-family:Helvetica;font-size:16px;line-height:150%;text-align:left;}
      .bodyContainer .mcnTextContent a,.bodyContainer .mcnTextContent p a{color:#007C89;font-weight:normal;text-decoration:underline;}
      #templateFooter{background-color:#333333;background-image:none;background-repeat:no-repeat;background-position:center;background-size:cover;border-top:0;border-bottom:0;padding-top:0px;padding-bottom:0px;}
      .footerContainer{background-color:transparent;background-image:none;background-repeat:no-repeat;background-position:center;background-size:cover;border-top:0;border-bottom:0;padding-top:0;padding-bottom:0;}
      .footerContainer .mcnTextContent,.footerContainer .mcnTextContent p{color:#FFFFFF;font-family:Helvetica;font-size:12px;line-height:150%;text-align:center;}
      .footerContainer .mcnTextContent a,.footerContainer .mcnTextContent p a{color:#FFFFFF;font-weight:normal;text-decoration:underline;}
      @media only screen and (min-width:768px){.templateContainer{width:600px !important;}}
      @media only screen and (max-width:480px){body,table,td,p,a,li,blockquote{-webkit-text-size-adjust:none !important;}}
      @media only screen and (max-width:480px){body{width:100% !important;min-width:100% !important;}}
      @media only screen and (max-width:480px){.mcnRetinaImage{max-width:100% !important;}}
      @media only screen and (max-width:480px){.mcnImage{width:100% !important;}}
      @media only screen and (max-width:480px){.mcnTextContent,.mcnBoxedTextContentColumn{padding-right:18px !important;padding-left:18px !important;}}
    </style>
  </head>
  <body style="height:100%;margin:0;padding:0;width:100%;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;">
    <span class="mcnPreviewText" style="display:none;font-size:0px;line-height:0px;max-height:0px;max-width:0px;opacity:0;overflow:hidden;visibility:hidden;mso-hide:all;">${esc(hook.substring(0, 150))}</span>
    <center>
      <table align="center" border="0" cellpadding="0" cellspacing="0" height="100%" width="100%" id="bodyTable" style="border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;height:100%;margin:0;padding:0;width:100%;">
        <tr>
          <td align="center" valign="top" id="bodyCell" style="mso-line-height-rule:exactly;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;height:100%;margin:0;padding:0;width:100%;">
            <table border="0" cellpadding="0" cellspacing="0" width="100%" style="border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;">
              <!-- HEADER -->
              <tr>
                <td align="center" valign="top" id="templateHeader" style="background:#F7F7F7 none no-repeat 50% 50%/cover;mso-line-height-rule:exactly;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;background-color:#F7F7F7;background-image:none;background-repeat:no-repeat;background-position:50% 50%;background-size:cover;border-top:0;border-bottom:0;padding-top:0px;padding-bottom:0px;">
                  <!--[if (gte mso 9)|(IE)]><table align="center" border="0" cellspacing="0" cellpadding="0" width="600" style="width:600px;"><tr><td align="center" valign="top" width="600" style="width:600px;"><![endif]-->
                  <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" class="templateContainer" style="border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;max-width:600px !important;">
                    <tr>
                      <td valign="top" class="headerContainer" style="background:transparent none no-repeat center/cover;mso-line-height-rule:exactly;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;background-color:transparent;background-image:none;background-repeat:no-repeat;background-position:center;background-size:cover;border-top:0;border-bottom:0;padding-top:0;padding-bottom:0;"></td>
                    </tr>
                  </table>
                  <!--[if (gte mso 9)|(IE)]></td></tr></table><![endif]-->
                </td>
              </tr>
              <!-- BODY -->
              <tr>
                <td align="center" valign="top" id="templateBody" style="background:#FFFFFF none no-repeat center/cover;mso-line-height-rule:exactly;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;background-color:#FFFFFF;background-image:none;background-repeat:no-repeat;background-position:center;background-size:cover;border-top:0;border-bottom:0;padding-top:66px;padding-bottom:66px;">
                  <!--[if (gte mso 9)|(IE)]><table align="center" border="0" cellspacing="0" cellpadding="0" width="600" style="width:600px;"><tr><td align="center" valign="top" width="600" style="width:600px;"><![endif]-->
                  <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" class="templateContainer" style="border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;max-width:600px !important;">
                    <tr>
                      <td valign="top" class="bodyContainer" style="background:transparent none no-repeat center/cover;mso-line-height-rule:exactly;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;background-color:transparent;background-image:none;background-repeat:no-repeat;background-position:center;background-size:cover;border-top:0;border-bottom:0;padding-top:0;padding-bottom:0;">
                        <!-- Text Block -->
                        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="min-width:100%;border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;">
                          <tr>
                            <td valign="top" style="padding-top:9px;mso-line-height-rule:exactly;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;">
                              <table align="left" border="0" cellpadding="0" cellspacing="0" style="max-width:100%;min-width:100%;border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;float:left;" width="100%" class="mcnTextContentContainer">
                                <tr>
                                  <td valign="top" class="mcnTextContent" style="padding:0px 18px 9px;color:#222222;mso-line-height-rule:exactly;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;word-break:break-word;font-family:Helvetica;font-size:16px;line-height:150%;text-align:left;">
                                    ${imageSection}
                                    ${hook ? `<p dir="ltr" style="color:#222222;margin:10px 0;padding:0;mso-line-height-rule:exactly;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;font-family:Helvetica;font-size:16px;line-height:150%;text-align:left;"><span style="font-size:18px">${esc(hook)}</span></p>` : ''}
                                    ${stat ? `<p dir="ltr" style="color:#222222;margin:10px 0;padding:0;mso-line-height-rule:exactly;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;font-family:Helvetica;font-size:16px;line-height:150%;text-align:left;">${highlightStat(stat, highlight)}</p>` : ''}
                                    ${context ? `<p dir="ltr" style="color:#222222;margin:10px 0;padding:0;mso-line-height-rule:exactly;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;font-family:Helvetica;font-size:16px;line-height:150%;text-align:left;"><span style="font-size:18px">${esc(context)}</span></p>` : ''}
                                    ${solution ? `<p dir="ltr" style="color:#222222;margin:10px 0;padding:0;mso-line-height-rule:exactly;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;font-family:Helvetica;font-size:16px;line-height:150%;text-align:left;"><span style="font-size:18px">${esc(solution)}</span></p>` : ''}
                                  </td>
                                </tr>
                              </table>
                            </td>
                          </tr>
                        </table>
                        <!-- CTA Button -->
                        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="min-width:100%;border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;">
                          <tr>
                            <td style="padding-top:0;padding-right:18px;padding-bottom:18px;padding-left:18px;mso-line-height-rule:exactly;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;" valign="top" align="center">
                              <table border="0" cellpadding="0" cellspacing="0" style="border-collapse:separate !important;border-radius:26px;background-color:#2BAADF;mso-table-lspace:0pt;mso-table-rspace:0pt;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;">
                                <tr>
                                  <td align="center" valign="middle" style="font-family:Arial;font-size:16px;padding:18px;mso-line-height-rule:exactly;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;">
                                    <a class="mcnButton" title="${esc(ctaLabel)}" href="${esc(CTA_URL)}" target="_blank" style="font-weight:bold;letter-spacing:normal;line-height:100%;text-align:center;text-decoration:none;color:#FFFFFF;mso-line-height-rule:exactly;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;display:block;">${esc(ctaLabel)}</a>
                                  </td>
                                </tr>
                              </table>
                            </td>
                          </tr>
                        </table>
                        <!-- Social Bar -->
                        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="min-width:100%;border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;">
                          <tr>
                            <td align="center" valign="top" style="padding:9px;mso-line-height-rule:exactly;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;">
                              <table border="0" cellpadding="0" cellspacing="0" width="100%" style="min-width:100%;background-color:#31AFE2;border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;">
                                <tr>
                                  <td align="center" valign="top" style="padding-top:9px;padding-right:9px;padding-left:9px;mso-line-height-rule:exactly;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;">
                                    <table align="center" border="0" cellpadding="0" cellspacing="0" style="border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;">
                                      <tr>
                                        ${socialIconsHtml}
                                      </tr>
                                    </table>
                                  </td>
                                </tr>
                              </table>
                            </td>
                          </tr>
                        </table>
                        <!-- Divider -->
                        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="min-width:100%;border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;table-layout:fixed !important;">
                          <tr>
                            <td style="min-width:100%;padding:18px;mso-line-height-rule:exactly;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;">
                              <table class="mcnDividerContent" border="0" cellpadding="0" cellspacing="0" width="100%" style="min-width:100%;border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;">
                                <tr><td style="mso-line-height-rule:exactly;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;"><span></span></td></tr>
                              </table>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                  <!--[if (gte mso 9)|(IE)]></td></tr></table><![endif]-->
                </td>
              </tr>
              <!-- FOOTER -->
              <tr>
                <td align="center" valign="top" id="templateFooter" style="background:#333333 none no-repeat center/cover;mso-line-height-rule:exactly;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;background-color:#333333;background-image:none;background-repeat:no-repeat;background-position:center;background-size:cover;border-top:0;border-bottom:0;padding-top:0px;padding-bottom:0px;">
                  <!--[if (gte mso 9)|(IE)]><table align="center" border="0" cellspacing="0" cellpadding="0" width="600" style="width:600px;"><tr><td align="center" valign="top" width="600" style="width:600px;"><![endif]-->
                  <table align="center" border="0" cellpadding="0" cellspacing="0" width="100%" class="templateContainer" style="border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;max-width:600px !important;">
                    <tr>
                      <td valign="top" class="footerContainer" style="background:transparent none no-repeat center/cover;mso-line-height-rule:exactly;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;background-color:transparent;background-image:none;background-repeat:no-repeat;background-position:center;background-size:cover;border-top:0;border-bottom:0;padding-top:0;padding-bottom:0;">
                        <table border="0" cellpadding="0" cellspacing="0" width="100%" style="min-width:100%;border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;">
                          <tr>
                            <td valign="top" style="padding-top:9px;mso-line-height-rule:exactly;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;">
                              <table align="left" border="0" cellpadding="0" cellspacing="0" style="max-width:100%;min-width:100%;border-collapse:collapse;mso-table-lspace:0pt;mso-table-rspace:0pt;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;float:left;" width="100%">
                                <tr>
                                  <td valign="top" style="padding-top:0;padding-right:18px;padding-bottom:9px;padding-left:18px;mso-line-height-rule:exactly;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;word-break:break-word;color:#FFFFFF;font-family:Helvetica;font-size:12px;line-height:150%;text-align:center;">
                                    <em>${esc(FOOTER_COPYRIGHT)}</em><br><br>
                                    <strong>Our mailing address is:</strong><br>
                                    ${esc(FOOTER_ADDRESS)}<br><br>
                                    Want to change how you receive these emails?<br>
                                    You can <a href="${esc(FOOTER_PREFS_URL)}" style="mso-line-height-rule:exactly;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;color:#FFFFFF;font-weight:normal;text-decoration:underline;">update your preferences</a> or <a href="${esc(FOOTER_UNSUB_URL)}" style="mso-line-height-rule:exactly;-ms-text-size-adjust:100%;-webkit-text-size-adjust:100%;color:#FFFFFF;font-weight:normal;text-decoration:underline;">unsubscribe from this list</a>.
                                  </td>
                                </tr>
                              </table>
                            </td>
                          </tr>
                        </table>
                      </td>
                    </tr>
                  </table>
                  <!--[if (gte mso 9)|(IE)]></td></tr></table><![endif]-->
                </td>
              </tr>
            </table>
          </td>
        </tr>
      </table>
    </center>
  </body>
</html>`.trim();
}

// ── Copy button — icon only, copies rich HTML for Gmail ──────────────────────
const CopyButton = ({ newsletter }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      const html = buildGmailHtml(newsletter);
      if (window.ClipboardItem) {
        await navigator.clipboard.write([
          new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }) }),
        ]);
      } else {
        await navigator.clipboard.writeText(html);
      }
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  return (
    <Tooltip title={copied ? "Copied!" : "Copy to clipboard"} placement="top">
      <IconButton
        onClick={handleCopy}
        size="small"
        sx={{
          color: copied ? "#10b981" : "#94a3b8",
          border: "1px solid",
          borderColor: copied ? "#10b981" : "#334155",
          borderRadius: 1,
          p: 0.6,
          "&:hover": { borderColor: "#3b82f6", color: "#3b82f6" },
        }}
      >
        {copied
          ? <CheckIcon sx={{ fontSize: 16 }} />
          : <ContentCopyIcon sx={{ fontSize: 16 }} />
        }
      </IconButton>
    </Tooltip>
  );
};

// ── Newsletter preview — Tzunami branded email-style template ──────────────────
const RenderedNewsletter = ({ newsletter }) => {
  const c = newsletter.content || {};

  // Support both new format (4 paragraphs) and old format (headline/analyst_note/sections)
  const hook      = c.hook_paragraph || null;
  const stat      = c.stat_paragraph || null;
  const source    = c.source_name || "";
  const sourceUrl = c.source_url || "#";
  const highlight = c.highlight_stat || "";
  const context   = c.context_paragraph || null;
  const solution  = c.solution_paragraph || null;
  const ctaLabel  = c.cta_label || "👉 Request a Free Demo";
  const imageData = c.image_data || "";

  // Legacy format detection
  const question = c.question || c.headline || null;
  const answer   = c.answer   || c.analyst_note || null;
  const isLegacy = !hook && !stat && (question || c.headline || c.sections?.length);

  // Highlight stat in red within stat_paragraph
  const renderStatWithHighlight = (text, stat) => {
    if (!stat) return text;
    const parts = text.split(new RegExp(`(${stat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'i'));
    return parts.map((p, i) =>
      p.toLowerCase() === stat.toLowerCase()
        ? <Box key={i} component="span" sx={{ color: "#B22222", fontWeight: "bold" }}>{p}</Box>
        : p
    );
  };

  return (
    <Box sx={{ bgcolor: "white", p: { xs: 1.5, md: 2.5 }, borderRadius: 1, color: "black",
      maxWidth: 560, mx: "auto" }}>

      {/* Top rule */}
      <Box sx={{ borderTop: "2px solid #dddddd", mb: 2 }} />

      {isLegacy ? (
        /* ── Legacy format fallback ── */
        <Box>
          <Typography sx={{ fontWeight: 800, fontSize: "1.1rem", color: "#1e293b", mb: 0.5 }}>
            {c.headline}
          </Typography>
          {c.analyst_note && (
            <Typography variant="body2" sx={{ color: "#374151", lineHeight: 1.6, mt: 1.5, fontSize: "0.82rem" }}>
              {c.analyst_note}
            </Typography>
          )}
          {(c.sections || []).map((s, si) => (
            <Box key={si} sx={{ mt: 2 }}>
              <Typography sx={{ fontWeight: 700, color: "#1e293b", mb: 0.5, fontSize: "0.85rem" }}>{s.title}</Typography>
              {(s.stories || []).map((st, i) => (
                <Box key={i} sx={{ mb: 1 }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, fontSize: "0.78rem" }}>{st.title}</Typography>
                  <Typography variant="body2" sx={{ color: "#374151", fontSize: "0.75rem" }}>{st.summary}</Typography>
                </Box>
              ))}
            </Box>
          ))}
        </Box>
      ) : (
        /* ── New Tzunami format ── */
        <>
          {/* Hero Image */}
          {imageData && (
            <Box sx={{ mb: 2, textAlign: "center" }}>
              <Box
                component="img"
                src={`data:image/png;base64,${imageData}`}
                alt="Newsletter hero"
                sx={{ width: "100%", maxHeight: 400, objectFit: "cover", borderRadius: 1 }}
              />
            </Box>
          )}

          {/* Hook paragraph */}
          {hook && (
            <Typography sx={{ color: "#757575", fontSize: "0.9rem", lineHeight: 1.6, mb: 1.5 }}>
              {hook}
            </Typography>
          )}

          {/* Stat paragraph with red highlight */}
          {stat && (
            <Typography sx={{ color: "#757575", fontSize: "0.9rem", lineHeight: 1.6, mb: 1.5 }}>
              {renderStatWithHighlight(stat, highlight)}
            </Typography>
          )}

          {/* Context paragraph */}
          {context && (
            <Typography sx={{ color: "#757575", fontSize: "0.9rem", lineHeight: 1.6, mb: 1.5 }}>
              {context}
            </Typography>
          )}

          {/* Solution paragraph */}
          {solution && (
            <Typography sx={{ color: "#757575", fontSize: "0.9rem", lineHeight: 1.6, mb: 2 }}>
              {solution}
            </Typography>
          )}

          {/* CTA button — blue pill */}
          <Box sx={{ textAlign: "center", mb: 2 }}>
            <Box
              component="a"
              href={CTA_URL}
              target="_blank"
              rel="noopener noreferrer"
              sx={{
                display: "inline-block",
                bgcolor: "#2BAADF",
                color: "#ffffff",
                px: 3, py: 1,
                borderRadius: "50px",
                fontWeight: "bold",
                fontSize: "0.85rem",
                textDecoration: "none",
                "&:hover": { bgcolor: "#25a0c4" },
              }}
            >
              {ctaLabel}
            </Box>
          </Box>

          {/* Social bar — blue (#31AFE2) with Mailchimp-style icons */}
          <Box sx={{
            bgcolor: "#31AFE2",
            py: 1.25, mb: 2,
            borderRadius: "2px",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 1,
          }}>
            {SOCIAL_LINKS.map(({ name, url, icon }) => (
              <Box
                key={name}
                component="a"
                href={url}
                title={name}
                target="_blank"
                rel="noopener noreferrer"
                sx={{
                  width: 26, height: 26,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  textDecoration: "none",
                  flexShrink: 0,
                  "&:hover": { opacity: 0.85 },
                }}
              >
                <Box
                  component="img"
                  src={icon}
                  alt={name}
                  sx={{ width: 24, height: 24 }}
                />
              </Box>
            ))}
          </Box>

          {/* Divider */}
          <Box sx={{ height: 18 }} />
        </>
      )}

      {/* Bottom rule */}
      <Box sx={{ borderTop: "1px solid #dddddd", mt: 2 }} />
    </Box>
  );
};


// ── Sidebar newsletter entry with hover-reveal delete ────────────────────────
const SidebarNewsletterEntry = ({ nl, isSelected, onSelect, onDelete, formatDate,
  selectedItemBg, selectedItemBdr, C }) => {
  const [hovered, setHovered] = useState(false);
  return (
    <Box
      onClick={onSelect}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      sx={{
        p: 2,
        bgcolor: isSelected ? selectedItemBg : C.cardInner,
        border: "1px solid",
        borderColor: isSelected ? selectedItemBdr : C.border,
        borderRadius: 1.5, cursor: "pointer",
        transition: "all 0.2s",
        "&:hover": { borderColor: "#3b82f6", bgcolor: C.hover },
      }}
    >
      <Box sx={{ display: "flex", justifyContent: "space-between",
        alignItems: "flex-start", gap: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="body2" sx={{ color: C.text, fontWeight: 600,
            fontSize: "0.8rem", overflow: "hidden", textOverflow: "ellipsis",
            whiteSpace: "nowrap" }}>
            {nl.title}
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 0.5 }}>
            <CalendarTodayIcon sx={{ fontSize: 11, color: C.textMuted }} />
            <Typography variant="caption" sx={{ color: C.textMuted, fontSize: "0.68rem" }}>
              {formatDate(nl.article_date)}
            </Typography>
          </Box>
        </Box>
        {hovered ? (
          <Tooltip title="Delete">
            <IconButton size="small"
              onClick={(e) => { e.stopPropagation(); onDelete(nl.id); }}
              sx={{ p: 0.2, color: C.textMuted, "&:hover": { color: "#ef4444" } }}>
              <DeleteOutlineIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        ) : (
          <Chip
            label={`${nl.article_count} art.`}
            size="small"
            sx={{ bgcolor: C.hover, color: C.textSub,
              fontSize: "0.6rem", height: 18, flexShrink: 0 }}
          />
        )}
      </Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 1, minWidth: 0, overflow: "hidden" }}>
        <AutoAwesomeIcon sx={{ fontSize: 11, flexShrink: 0,
          color: PROVIDER_COLORS[nl.provider] || C.textMuted }} />
        <Typography variant="caption" sx={{
          color: PROVIDER_COLORS[nl.provider] || C.textMuted,
          fontSize: "0.65rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {nl.provider} · {nl.model}
        </Typography>
      </Box>
    </Box>
  );
};

// ══════════════════════════════════════════════════════════════════════════════
const Newsletter = () => {
  const { C, isDark } = useAppTheme();
  const theme    = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down("md"));
  const [newsletters,  setNewsletters]  = useState([]);
  const [selected,     setSelected]     = useState(null);
  const [loading,      setLoading]      = useState(true);
  const [dateFilter,   setDateFilter]   = useState("");
  const [sidebarOpen,  setSidebarOpen]  = useState(() => {
    try {
      const stored = localStorage.getItem(SIDEBAR_KEY);
      if (stored !== null) return stored !== "false";
    } catch {}
    return typeof window === "undefined" || window.innerWidth >= 960;
  });

  const toggleSidebar = () => {
    setSidebarOpen((prev) => {
      const next = !prev;
      try { localStorage.setItem(SIDEBAR_KEY, String(next)); } catch {}
      return next;
    });
  };

  const fetchNewsletters = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await apiFetch(`${API_BASE}/api/newsletters`);
      if (res.ok) {
        const data = await res.json();
        const list = data.newsletters || [];
        setNewsletters(list);
        setSelected(prev => {
          if (prev === null) return list.length > 0 ? list[0] : null;
          const updated = list.find(n => n.id === prev.id);
          return updated ?? prev;
        });
      }
    } catch (e) {
      console.error("Failed to fetch newsletters:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchNewsletters();
    const id = setInterval(() => fetchNewsletters(true), 30_000);
    return () => clearInterval(id);
  }, []);

  const handleDelete = async (id) => {
    try {
      await apiFetch(`${API_BASE}/api/newsletters/${id}`, { method: "DELETE" });
    } catch {}
    setNewsletters(prev => prev.filter(n => n.id !== id));
    if (selected?.id === id) {
      const remaining = newsletters.filter(n => n.id !== id);
      setSelected(remaining.length > 0 ? remaining[0] : null);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return "—";
    try {
      return new Date(dateStr + "T00:00:00").toLocaleDateString("en-US", {
        weekday: "short", year: "numeric", month: "short", day: "numeric",
      });
    } catch { return dateStr; }
  };

  const selectedItemBg  = isDark ? "#1e3a5f" : "#dbeafe";
  const selectedItemBdr = "#3b82f6";

  return (
    <Box sx={{ width: "100%", overflowX: "hidden" }}>
      {/* Header */}
      <Box sx={{ mb: { xs: 3, md: 4 } }}>
        <Typography sx={{ fontWeight: "bold", color: C.text,
          fontSize: { xs: "1.2rem", sm: "1.4rem", md: "1.5rem" } }}>
          Newsletter
        </Typography>
      </Box>

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", py: 12 }}>
          <CircularProgress sx={{ color: "#3b82f6" }} />
        </Box>
      ) : newsletters.length === 0 ? (
        <Card sx={{ bgcolor: C.card, border: `1px solid ${C.border}`, borderRadius: 2, boxShadow: C.shadow }}>
          <CardContent sx={{ py: 8, textAlign: "center" }}>
            <AutoAwesomeIcon sx={{ color: C.border, fontSize: 56, mb: 2 }} />
            <Typography sx={{ color: C.text, fontWeight: 700, mb: 1 }}>
              No Newsletters Yet
            </Typography>
            <Typography variant="body2" sx={{ color: C.textMuted, maxWidth: 420, mx: "auto" }}>
              Run a Google News collection → approve the data via webhook →
              the AI will automatically generate a newsletter here.
            </Typography>
            <Box sx={{ mt: 3, p: 2, bgcolor: C.cardInner, borderRadius: 2,
              border: `1px solid ${C.border}`, maxWidth: 500, mx: "auto", textAlign: "left" }}>
              <Typography variant="caption" sx={{ color: "#3b82f6", fontWeight: 700,
                display: "block", mb: 1 }}>
                HOW IT WORKS
              </Typography>
              {[
                "1. Go to Monitoring → run Google News",
                "2. Results are sent to your webhook URL for review",
                "3. External system approves via POST /webhook/google-news/response",
                "4. Articles saved → AI generates one newsletter → appears here",
              ].map((s, i) => (
                <Typography key={i} variant="caption" sx={{ color: C.textMuted,
                  display: "block", mb: 0.5 }}>
                  {s}
                </Typography>
              ))}
            </Box>
          </CardContent>
        </Card>
      ) : (
        <Box sx={{ display: "flex", flexDirection: { xs: "column", md: "row" },
          gap: 3, width: "100%", alignItems: "flex-start", minWidth: 0 }}>

          {/* Left sidebar — collapsible, sticky */}
          <Box sx={{
            width: sidebarOpen ? { xs: "100%", md: "280px" } : { xs: "100%", md: "44px" },
            flexShrink: 0,
            transition: "width 0.2s ease",
            position: { md: "sticky" }, top: 0,
            maxHeight: { md: "calc(100vh - 56px - 64px)" },
            display: "flex", flexDirection: "column",
            overflowX: "hidden",
            minWidth: 0,
          }}>
            <Card sx={{ bgcolor: C.card, border: `1px solid ${C.border}`, borderRadius: 2, boxShadow: C.shadow,
              display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>

              {/* Sidebar header — always visible */}
              <Box sx={{
                display: "flex", alignItems: "center",
                justifyContent: sidebarOpen ? "space-between" : "center",
                px: sidebarOpen ? 1.5 : 0.5, py: 1,
                borderBottom: `1px solid ${C.border}`, flexShrink: 0,
              }}>
                {sidebarOpen && (
                  <Box>
                    <Typography variant="subtitle2" sx={{ color: C.text, fontWeight: 600, fontSize: "0.82rem" }}>
                      Generated Newsletters
                    </Typography>
                    <Typography variant="caption" sx={{ color: C.textMuted, fontSize: "0.68rem" }}>
                      {newsletters.length} newsletter{newsletters.length !== 1 ? "s" : ""}
                    </Typography>
                  </Box>
                )}
                <Tooltip title={sidebarOpen ? "Collapse" : "Expand"} placement={isMobile ? "bottom" : "right"}>
                  <IconButton size="small" onClick={toggleSidebar}
                    sx={{ color: C.textMuted, p: 0.5, "&:hover": { color: C.text } }}>
                    {isMobile
                      ? (sidebarOpen ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />)
                      : (sidebarOpen ? <ChevronLeftIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />)
                    }
                  </IconButton>
                </Tooltip>
              </Box>

              {/* Newsletter list — only when open */}
              {sidebarOpen && (
              <>
                {/* Date filter */}
                <Box sx={{ px: 1.5, pt: 1.2, pb: 0.8, flexShrink: 0 }}>
                  <TextField
                    type="date"
                    size="small"
                    value={dateFilter}
                    onChange={(e) => setDateFilter(e.target.value)}
                    InputProps={{
                      startAdornment: (
                        <InputAdornment position="start">
                          <CalendarTodayIcon sx={{ fontSize: 13, color: C.textMuted }} />
                        </InputAdornment>
                      ),
                      endAdornment: dateFilter ? (
                        <InputAdornment position="end">
                          <IconButton size="small" onClick={() => setDateFilter("")}
                            sx={{ p: 0.2, color: C.textMuted }}>
                            <CloseIcon sx={{ fontSize: 13 }} />
                          </IconButton>
                        </InputAdornment>
                      ) : null,
                    }}
                    sx={{
                      width: "100%",
                      "& .MuiInputBase-root": {
                        bgcolor: C.cardInner, fontSize: "0.75rem", color: C.text,
                        "& fieldset": { borderColor: C.border },
                        "&:hover fieldset": { borderColor: C.textMuted },
                        "&.Mui-focused fieldset": { borderColor: "#3b82f6" },
                      },
                      "& input[type='date']::-webkit-calendar-picker-indicator": {
                        filter: isDark ? "invert(1)" : "none", opacity: 0.5, cursor: "pointer",
                      },
                    }}
                  />
                </Box>

                <CardContent sx={{ p: { xs: 2, md: 1.5 }, flex: 1, overflowY: "auto" }}>
                  <Stack spacing={1}>
                    {(dateFilter
                      ? newsletters.filter(nl => (nl.article_date || "").startsWith(dateFilter))
                      : newsletters
                    ).map((nl) => (
                      <SidebarNewsletterEntry
                        key={nl.id}
                        nl={nl}
                        isSelected={selected?.id === nl.id}
                        onSelect={() => {
                          setSelected(nl);
                          if (typeof window !== "undefined" && window.innerWidth < 960) setSidebarOpen(false);
                        }}
                        onDelete={handleDelete}
                        formatDate={formatDate}
                        selectedItemBg={selectedItemBg}
                        selectedItemBdr={selectedItemBdr}
                        C={C}
                      />
                    ))}
                  </Stack>
                </CardContent>
              </>
              )}
            </Card>
          </Box>

          {/* Right — preview */}
          <Box sx={{ flex: 1, minWidth: 0, overflowX: "hidden" }}>
            {selected ? (
              <Card sx={{ bgcolor: C.card, border: `1px solid ${C.border}`,
                borderRadius: 2, boxShadow: C.shadow }}>

                {/* Preview header with copy button */}
                <Box sx={{
                  display: "flex", alignItems: "center",
                  justifyContent: "space-between",
                  borderBottom: `1px solid ${C.border}`,
                  px: 2, py: 1.25,
                  flexWrap: "wrap", gap: 1,
                }}>
                  <Typography variant="subtitle1" sx={{ color: C.text, fontWeight: 600,
                    fontSize: { xs: "0.85rem", md: "0.95rem" } }}>
                    {selected.title}
                  </Typography>
                  <CopyButton newsletter={selected} />
                </Box>

                <Box sx={{ p: { xs: 2, md: 3 }, bgcolor: C.cardInner }}>
                  <RenderedNewsletter newsletter={selected} />
                </Box>
              </Card>
            ) : (
              <Card sx={{ bgcolor: C.card, border: `1px solid ${C.border}`,
                borderRadius: 2, height: "100%", display: "flex",
                alignItems: "center", justifyContent: "center", boxShadow: C.shadow }}>
                <Box sx={{ textAlign: "center", py: 8 }}>
                  <ArticleIcon sx={{ color: C.border, fontSize: 48, mb: 2 }} />
                  <Typography variant="body2" sx={{ color: C.textSub }}>
                    Select a newsletter from the left to preview it
                  </Typography>
                </Box>
              </Card>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
};

export default Newsletter;
