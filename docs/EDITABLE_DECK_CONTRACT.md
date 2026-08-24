# Editable deck contract

## 文件模型

- 原始 HTML 是 canonical source；編輯 iframe DOM 是工作副本。
- 未改動區域以 source offsets 原樣保留。
- 文字、樣式與一般幾何使用細粒度 patch。
- 頁面新增、複製、刪除或重排時，只重建已識別 deck container 的 children；deck 之外內容不重寫。
- 講者備註只接受可靜態解析的 `SPEAKER_NOTES` string-array assignment，禁止 `eval` 或執行來源 script。

## Flow-safe unlock

首次拖動／縮放 flow 元素時，編輯器以單一 history transaction 將它轉成自由定位：

1. 在原 flow 位置放入不可見、等尺寸的 semantic placeholder。
2. 保留原元素本體與 `data-editor-id`，將其切換成 absolute positioning。
3. 以文件座標儲存 `left/top/width/height`，避免 sibling reflow。
4. Undo 回復轉換前完整 DOM；Redo 重做同一 transaction。

因此未選 sibling 的 bounding box 變化必須不超過 1px，原元素 identity 亦維持。

## Page 與 notes mapping

- slide order、selected slide index 與 notes array 在同一 snapshot history 中保存。
- duplicate 同步複製 slide 與對應 notes；reorder 同步移動；delete 同步移除。
- 新複製 slide 的 editor IDs 重新配置，避免 selector collision。

## Group contract

- group 將同頁選取物件包入 editor-managed free layer container。
- ungroup 回復子物件到 parent free layer並保留畫面幾何。
- group／ungroup、align／distribute 都是可 Undo／Redo 的單一命令。
- 只在頁面結構已變更時使用 deck-children serialization；其餘匯出維持細粒度 patch。

## 安全與失敗行為

- 編輯模式移除／停用來源 script；執行預覽在 sandboxed iframe。
- speaker notes parser 遇到 expression、template interpolation 或非字串陣列時 fail closed。
- ZIP 拒絕 absolute path、`..` traversal 與 symlink。
- 任何 mapping 無法可信建立的 runtime DOM、Shadow DOM、canvas-only 結構維持唯讀。

