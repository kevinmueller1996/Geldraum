import { NextRequest } from "next/server";
import { confirm, grantFor, propose, type Grant } from "../../../chatgpt/changes";
import { metadata, resource } from "../../../chatgpt/config";
import { handleMcp, McpUserError } from "../../../chatgpt/mcp";
import { authorize, exchange, manage, oauthJson, revoke } from "../../../chatgpt/oauth";
import { currentPlan } from "../../../chatgpt/storage";
import { needsCloudflareBackendProxy } from "../../../vercel/proxy-api";
import { proxyPlugin } from "../../../chatgpt/proxy";

export const dynamic = "force-dynamic";

const methods: Record<string,string[]> = {
  authorize:["GET","POST"],token:["POST"],revoke:["POST"],mcp:["GET","POST","DELETE"],
  confirm:["GET","POST"],manage:["GET","POST"]
};
async function dispatch(request: NextRequest, ctx: {params:Promise<{action:string}>}) {
  const {action} = await ctx.params;
  if (!Object.hasOwn(methods,action)) return new Response(null,{status:404});
  if (!methods[action].includes(request.method)) return new Response(null,{status:405,headers:{Allow:methods[action].join(", ")}});
  try {
    if (needsCloudflareBackendProxy()) return await proxyPlugin(request,action);
    if (action === "authorize") return await authorize(request);
    if (action === "token") return await exchange(request);
    if (action === "revoke") return await revoke(request);
    if (action === "confirm") return await confirm(request);
    if (action === "manage") return await manage(request);
    let grant: Grant | null = null;
    return await handleMcp(request,{
      resource, metadataUrl: metadata,
      authorize: async req => {
        grant = await grantFor(req);
        return grant ? {userId:grant.user_id, scopes:grant.scope.split(" ")} : null;
      },
      readPlan: async userId => (await currentPlan(userId)).plan,
      createProposal: async (userId, changes) => {
        if (!grant || grant.user_id !== userId) throw new McpUserError("Bitte verbinde dein Konto erneut.");
        return propose(grant,changes);
      }
    });
  } catch(error) {
    if (error instanceof McpUserError) return oauthJson({error:error.message},403);
    return oauthJson({error:"temporarily_unavailable"},503);
  }
}
export { dispatch as GET, dispatch as POST, dispatch as DELETE };

