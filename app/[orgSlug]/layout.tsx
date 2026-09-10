import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createServiceClient } from "@/server";

type Organization = {
  name: string;
  logo_url: string | null;
  primary_color: string;
};

async function getOrganization(slug: string): Promise<Organization | null> {
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("organizations")
    .select("name, logo_url, primary_color")
    .eq("slug", slug)
    .maybeSingle();

  if (error) throw new Error(`Unable to load organization: ${error.message}`);
  return data;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}): Promise<Metadata> {
  const { orgSlug } = await params;
  const organization = await getOrganization(orgSlug);
  if (!organization) return {};

  return {
    title: organization.name,
    icons: organization.logo_url ? { icon: organization.logo_url } : undefined,
  };
}

export default async function OrganizationLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const organization = await getOrganization(orgSlug);
  if (!organization) notFound();

  return (
    <section style={{ "--organization-primary": organization.primary_color } as React.CSSProperties}>
      <header className="border-b bg-white px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center gap-3">
          {organization.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img alt="" className="h-8 w-8 rounded object-contain" src={organization.logo_url} />
          ) : (
            <span
              aria-hidden="true"
              className="h-8 w-8 rounded"
              style={{ backgroundColor: organization.primary_color }}
            />
          )}
          <span className="font-semibold">{organization.name}</span>
        </div>
      </header>
      {children}
    </section>
  );
}
