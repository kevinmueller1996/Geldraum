import { issuerInfo } from "../../chatgpt/config";
export function GET() { return Response.json(issuerInfo); }

