# Current limitations

Local HTML Slide Editor deliberately keeps its editing scope bounded so that unsupported structures fail clearly instead of being modified unpredictably.

1. **HTML compatibility is not universal.** Fixed canvases and ordinary static flow/flex/grid layouts are supported, while runtime-controlled DOM, Shadow DOM, canvas-only rendering, and structures without a reliable source mapping may remain read-only.
2. **Some nested transforms are only partially editable.** High-risk subtrees can restrict drag/resize operations while unaffected parts of the document remain usable.
3. **Browser workspaces are local to the current browser profile.** Clearing site data, private browsing, or changing browsers/devices can remove browser-stored workspace state. Exported HTML or ZIP is the portable copy.
4. **Concurrent editing is not supported.** The editor does not merge simultaneous external source changes or provide real-time multi-user collaboration.
5. **Structural slide edits can normalize markup inside the deck boundary.** Adding, duplicating, deleting, or reordering slides may normalize comments, whitespace, or attribute ordering inside the identified deck container. Content outside that boundary is preserved.
6. **Security protections are scoped.** Edit mode disables source scripts, execution preview is sandboxed, and ZIP imports reject unsafe paths, but the project does not claim a complete security certification for arbitrary untrusted content.
7. **Speaker notes use a constrained source format.** Notes are read from a statically analyzable `SPEAKER_NOTES` string-array assignment; dynamic expressions are rejected rather than executed.
8. **The interface is desktop-first.** The current interaction model is designed around pointer/keyboard presentation editing rather than a touch-first mobile workflow.
