import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { captureException, enforceRateLimit } from "@/lib/security";
import { createClient, createServiceClient } from "@/server";

function hashKey(key: string) {
  return createHash("sha256").update(key).digest("hex");
}

async function authorizeOrganizationManager(orgSlug: string) {
  const userClient = await createClient();
  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser();
  if (userError || !user) return { error: "Authentication is required.", status: 401 };

  const serviceClient = await createServiceClient();
  const { data: organization, error: organizationError } = await serviceClient
    .from("organizations")
    .select("id")
    .eq("slug", orgSlug)
    .maybeSingle();
  if (organizationError || !organization) return { error: "Organization not found.", status: 404 };

  const { data: membership, error: membershipError } = await serviceClient
    .from("organization_members")
    .select("role")
    .eq("organization_id", organization.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (membershipError) throw new Error(`Unable to verify membership: ${membershipError.message}`);
  if (!membership || !["owner", "admin"].includes(membership.role)) {
    return { error: "Organization administrator access is required.", status: 403 };
  }

  return { serviceClient, organizationId: organization.id, userId: user.id };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  const rateLimitResponse = await enforceRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  const { orgSlug } = await params;
  try {
    const authorization = await authorizeOrganizationManager(orgSlug);
    if ("error" in authorization) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }
    const { data, error } = await authorization.serviceClient
      .from("api_keys")
      .select("id, name, created_at, last_used_at")
      .eq("organization_id", authorization.organizationId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return NextResponse.json({ keys: data ?? [] });
  } catch (error) {
    captureException(error, { route: "organization-api-keys", orgSlug });
    return NextResponse.json({ error: "Unable to load API keys." }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  const rateLimitResponse = await enforceRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  const body: unknown = await request.json().catch(() => null);
  const name =
    body && typeof body === "object" && typeof (body as { name?: unknown }).name === "string"
      ? (body as { name: string }).name.trim()
      : "";
  if (!name) return NextResponse.json({ error: "A key name is required." }, { status: 400 });

  const { orgSlug } = await params;
  try {
    const authorization = await authorizeOrganizationManager(orgSlug);
    if ("error" in authorization) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }

    const secret = `tp_live_${randomBytes(32).toString("base64url")}`;
    const { data, error } = await authorization.serviceClient
      .from("api_keys")
      .insert({
        organization_id: authorization.organizationId,
        created_by_user_id: authorization.userId,
        key_hash: hashKey(secret),
        name,
      })
      .select("id, name, created_at, last_used_at")
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ key: { ...data, secret } }, { status: 201 });
  } catch (error) {
    captureException(error, { route: "organization-api-keys", orgSlug });
    return NextResponse.json({ error: "Unable to create API key." }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ orgSlug: string }> },
) {
  const rateLimitResponse = await enforceRateLimit(request);
  if (rateLimitResponse) return rateLimitResponse;

  const keyId = new URL(request.url).searchParams.get("keyId");
  if (!keyId) return NextResponse.json({ error: "keyId is required." }, { status: 400 });

  const { orgSlug } = await params;
  try {
    const authorization = await authorizeOrganizationManager(orgSlug);
    if ("error" in authorization) {
      return NextResponse.json({ error: authorization.error }, { status: authorization.status });
    }
    const { error } = await authorization.serviceClient
      .from("api_keys")
      .delete()
      .eq("id", keyId)
      .eq("organization_id", authorization.organizationId);
    if (error) throw new Error(error.message);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    captureException(error, { route: "organization-api-keys", orgSlug });
    return NextResponse.json({ error: "Unable to revoke API key." }, { status: 500 });
  }
}
