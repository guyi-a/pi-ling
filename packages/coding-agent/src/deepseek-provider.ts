import {
  createProvider,
  type Model,
  type MutableModels,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";

export const PI_LING_DEEPSEEK_PROVIDER = "deepseek" as const;
/** Official DeepSeek V4.1 Flash; registered at runtime until pi-ai catalog ships it. */
export const PI_LING_DEEPSEEK_MODEL = "deepseek-flash" as const;

function deepseekFlashModel(
  template: Model<"openai-completions">,
): Model<"openai-completions"> {
  return {
    ...template,
    id: PI_LING_DEEPSEEK_MODEL,
    name: "DeepSeek V4.1 Flash",
    input: ["text", "image"],
  };
}

/** Register DeepSeek with pi-ling's default model id until pi-ai ships it. */
export function registerPiLingDeepseekProvider(models: MutableModels): void {
  const base = deepseekProvider();
  const catalog: Model<"openai-completions">[] = [...base.getModels()];
  if (!catalog.some((model) => model.id === PI_LING_DEEPSEEK_MODEL)) {
    const template =
      catalog.find((model) => model.id === "deepseek-v4-flash-vision-exp") ??
      catalog.find((model) => model.id === "deepseek-v4-flash");
    if (template) {
      catalog.push(deepseekFlashModel(template));
    }
  }
  models.setProvider(
    createProvider({
      id: base.id,
      name: base.name,
      ...(base.baseUrl ? { baseUrl: base.baseUrl } : {}),
      ...(base.headers ? { headers: base.headers } : {}),
      auth: base.auth,
      models: catalog,
      api: openAICompletionsApi(),
    }),
  );
}
