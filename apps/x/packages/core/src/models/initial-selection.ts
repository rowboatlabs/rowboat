// Pure selection logic lives in @x/shared (the renderer's connect flow uses
// the same implementation); re-exported here for core call sites.
export { selectInitialModel, selectInitialTaskModels } from "@x/shared/dist/initial-selection.js";
