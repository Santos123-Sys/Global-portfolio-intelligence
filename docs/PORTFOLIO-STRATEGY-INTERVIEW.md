# Portfolio strategy interview

## User flow

The Portfolio Strategy page offers a Gemini conversation as the primary way to create or update a mandate. The model can ask follow-up questions and return a structured strategy draft. Users can request changes in the same conversation, then generate a downloadable PDF and enter the existing review queue.

The PDF is generated directly from the validated structured draft. It is not sent back through a second model for extraction. The queue row is marked completed locally and uses the same thesis criteria editor, review warnings, version checks, approval audit and `startDiscoveryAfterThesisConfirmation` transition as imported source documents. No draft becomes canonical and no Discovery run starts before explicit approval.

Uploaded strategy files remain available in the optional import section. Their existing remote extraction lifecycle is unchanged.

## Gemini configuration

The dashboard server reads `GEMINI_API_KEY`, already preserved in the Railway dashboard service configuration for document intelligence. The strategy interview calls the Gemini API server-side using `gemini-3.8-flash`; the API key is never sent to a browser bundle. No additional Railway variable is required for the model default.

## Data handling

Each chat turn sends the conversation and validated working draft to Gemini. The application does not persist the raw transcript. The generated structured mandate is stored in the existing thesis review queue. A PDF is downloaded immediately and can be regenerated from any approved thesis version through the authenticated strategy PDF route.

Only listed equity mandates enter this workflow. Current automated discovery coverage is B3 (BVMF) and SIX (XSWX); other markets are retained as authored and surfaced as unsupported for automated discovery.

## PDF structure

The short PDF adapts the attached equity-research report's decision-oriented structure without importing unsupported company analysis:

- Cover and strategy at a glance
- Executive summary and investment thesis
- Portfolio destinations and objectives
- Eligible universe and explicit selection rules
- Investment and valuation approach
- Portfolio construction and stated limits
- Risk, monitoring, governance and evidence limitations
- Human-review and no-trading disclosure

No market performance, company facts, forecasts, valuation outputs or citations are fabricated during strategy intake.
