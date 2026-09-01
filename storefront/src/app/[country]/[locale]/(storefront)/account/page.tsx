"use client";

import {
  CircleAlert,
  CreditCard,
  Eye,
  EyeOff,
  MapPin,
  ShoppingBag,
  User,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { AccountShell } from "@/components/account/AccountShell";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/contexts/AuthContext";
import { BRAND_BY_SHOP, SIGN_IN_BY_SHOP } from "@/lib/blocks/content";
import { isAccountRequired } from "@/lib/store";
import { resolveAccountRedirect } from "@/lib/utils/account-redirect";
import { extractBasePath } from "@/lib/utils/path";
import { shopKey } from "@/lib/shop-key";

export default function AccountPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const basePath = extractBasePath(pathname);
  const t = useTranslations("account");
  // His words for this shop where it has any, otherwise the shared translation.
  // He built his own login page for the wholesale shop and photographed ours
  // beside it; the five retail shops keep what they have, because he has not
  // reviewed those and changing copy he has not asked about is not ours to do.
  const shop = shopKey();
  const shopWords = SIGN_IN_BY_SHOP[shop] ?? {};
  const tt = (key: string) => shopWords[key] ?? t(key);
  // The framed mark above the card. Only the wholesale shop has one, so on the
  // other 5 this is undefined and nothing renders.
  const loginLogo = BRAND_BY_SHOP[shop]?.loginLogo;
  // Both links on his sign-in page are #6b6b6b, a plain grey, read off the
  // stylesheet of the page itself. Ours were the brand olive, which on a card
  // whose only other colour is a near-black button reads as two stray green
  // words. The 5 retail shops keep the olive, which is what he asked for there.
  const linkTone = isAccountRequired()
    ? "text-muted-foreground hover:text-foreground"
    : "text-primary hover:text-primary/70";
  const { login, isAuthenticated, loading: authLoading } = useAuth();

  // Get redirect URL from query params (e.g., from checkout)
  //
  // On a closed shop the target can be any page of this market, because every
  // page of it bounces here: someone sent a product link to a colleague, and
  // after signing in they should land on that product. The narrow rule allows
  // only /account and /checkout, so it discarded exactly the target the gate
  // had just taken the trouble to preserve, and the person arrived at their
  // account page with no sign of what they had followed.
  const redirectUrl = resolveAccountRedirect(
    searchParams.get("redirect"),
    basePath,
    isAccountRequired(),
  );

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const result = await login(email, password);
    if (result.success) {
      // Redirect to the specified URL or stay on account page
      if (redirectUrl) {
        router.push(redirectUrl);
      }
    } else {
      setError(result.error || t("invalidCredentials"));
    }
    setLoading(false);
  };

  // Show loading state while auth is initializing
  if (authLoading) {
    return (
      <div className="max-w-md mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/2 mx-auto" />
          <div className="h-4 bg-gray-200 rounded w-3/4 mx-auto" />
          <div className="h-48 bg-gray-200 rounded" />
        </div>
      </div>
    );
  }

  // Show login form if not authenticated
  if (!isAuthenticated) {
    // His own login page, measured from its stylesheet rather than eyeballed:
    // ground #f5f5f3, card #ffffff at a 16px radius with a soft double shadow
    // and no border, 420px wide, inputs filled #fafaf8 inside a #e2e2de border,
    // button radius 10px, and the register link aligned right. Every one of
    // those is a `--` variable in the <style> block of the page itself.
    //
    // The 5 retail shops keep the plain white card they have, which he has not
    // reviewed.
    const gated = isAccountRequired();
    return (
      <div
        className={
          gated
            ? "min-h-screen bg-[#f5f5f3] flex flex-col items-center justify-center px-4 py-16"
            : "max-w-md mx-auto px-4 sm:px-6 lg:px-8 py-16"
        }
      >
        {/* The mark above the card. One shop's own sign-in page has it and the
            rest do not, so it is driven off that shop's brand entry and is
            undefined everywhere else. The artwork carries its own wording, so
            no line is typed under it.

            No border, and 280px rather than the container width. Both come off
            his own stylesheet, which sets `.logo-wrap { margin-bottom: 28px;
            text-align: center }` and `.logo-wrap img { width: 280px }`. The
            rectangle around this block in the screenshot he sent is the box he
            drew to point at it, not a frame he has built, and copying it would
            have shipped his annotation as the design.

            priority, because it is the only image on this page and it is what
            someone looks at while the form is still working out whether they
            are signed in. */}
        {loginLogo ? (
          <div className="mb-7 text-center">
            <Image
              src={loginLogo.src}
              alt={loginLogo.alt}
              width={loginLogo.width}
              height={loginLogo.height}
              priority
              className="mx-auto h-auto w-[280px]"
            />
          </div>
        ) : null}
        <Card
          className={
            gated
              ? "w-full max-w-[420px] rounded-2xl border-0 bg-white px-9 pt-10 pb-8 shadow-[0_2px_24px_rgba(0,0,0,0.07),0_1px_4px_rgba(0,0,0,0.04)]"
              : undefined
          }
        >
          <CardHeader className="text-center">
            <CardTitle>{tt("myAccount")}</CardTitle>
            {/* An empty override means his page has no such line, so
                nothing renders rather than an empty element keeping its
                own margin. */}
            {tt("signInDescription") ? (
              <CardDescription>{tt("signInDescription")}</CardDescription>
            ) : null}
          </CardHeader>

          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <CircleAlert />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}

              <Field>
                <FieldLabel htmlFor="email">{tt("email")}</FieldLabel>
                <Input
                  type="email"
                  id="email"
                  name="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  // His reads "Your email or username". Ours is a worked
                  // example, which is fine on a retail shop and wrong on a
                  // portal whose customers sign in with an account name.
                  placeholder={tt("emailPlaceholder")}
                  className={
                    gated ? "bg-[#fafaf8] border-[#e2e2de]" : undefined
                  }
                />
              </Field>

              <Field>
                <FieldLabel htmlFor="password">{t("password")}</FieldLabel>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    id="password"
                    name="current-password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder={shopWords.passwordPlaceholder ?? "••••••••"}
                    className={`pr-10${gated ? " bg-[#fafaf8] border-[#e2e2de]" : ""}`}
                  />
                  <div className="absolute right-1 top-1/2 -translate-y-1/2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={
                        showPassword ? t("hidePassword") : t("showPassword")
                      }
                    >
                      {showPassword ? (
                        <EyeOff className="w-5 h-5" />
                      ) : (
                        <Eye className="w-5 h-5" />
                      )}
                    </Button>
                  </div>
                </div>
              </Field>

              <div className="flex justify-end">
                <Link
                  href={`${basePath}/account/forgot-password`}
                  className={`text-sm font-medium ${linkTone}`}
                >
                  {tt("forgotPassword")}
                </Link>
              </div>

              <div className="w-full">
                <Button
                  type="submit"
                  disabled={loading}
                  size="lg"
                  // Black on the wholesale shop. His own login button measures
                  // rgb(26,26,26), the --accent token his page sets. Olive on
                  // the retail shops, his brand colour, which he asked for.
                  className={`w-full${
                    gated
                      ? " rounded-[10px] bg-foreground text-background hover:bg-foreground/85"
                      : ""
                  }`}
                >
                  {loading ? t("signingIn") : tt("signIn")}
                </Button>
              </div>
            </form>
          </CardContent>

          <CardFooter className={gated ? "justify-end" : "justify-center"}>
            <p className="text-sm text-muted-foreground">
              {/* His page has the link alone. An empty override drops the
                  sentence in front of it rather than leaving a stray space. */}
              {tt("dontHaveAccount") ? `${tt("dontHaveAccount")} ` : null}
              <Link
                href={`${basePath}/account/register`}
                className={`font-medium ${linkTone}`}
              >
                {tt("signUp")}
              </Link>
            </p>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // Show account dashboard if authenticated
  return (
    <AccountShell>
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-6">
          {t("accountOverview")}
        </h1>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Link href={`${basePath}/account/orders`}>
            <Card className="hover:border-gray-300 transition-colors h-full">
              <CardContent className="flex items-center gap-4 py-0">
                <div className="p-3 bg-gray-100 rounded-xl">
                  <ShoppingBag className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-lg font-medium text-gray-900">
                    {t("orderHistory")}
                  </h2>
                  <p className="mt-1 text-sm text-gray-500">
                    {t("orderHistoryDescription")}
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href={`${basePath}/account/addresses`}>
            <Card className="hover:border-gray-300 transition-colors h-full">
              <CardContent className="flex items-center gap-4 py-0">
                <div className="p-3 bg-gray-100 rounded-xl">
                  <MapPin className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-lg font-medium text-gray-900">
                    {t("addresses")}
                  </h2>
                  <p className="mt-1 text-sm text-gray-500">
                    {t("addressesDescription")}
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href={`${basePath}/account/credit-cards`}>
            <Card className="hover:border-gray-300 transition-colors h-full">
              <CardContent className="flex items-center gap-4 py-0">
                <div className="p-3 bg-gray-100 rounded-xl">
                  <CreditCard className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-lg font-medium text-gray-900">
                    {t("paymentMethods")}
                  </h2>
                  <p className="mt-1 text-sm text-gray-500">
                    {t("paymentMethodsDescription")}
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>

          <Link href={`${basePath}/account/profile`}>
            <Card className="hover:border-gray-300 transition-colors h-full">
              <CardContent className="flex items-center gap-4 py-0">
                <div className="p-3 bg-gray-100 rounded-xl">
                  <User className="w-6 h-6 text-primary" />
                </div>
                <div>
                  <h2 className="text-lg font-medium text-gray-900">
                    {t("profile")}
                  </h2>
                  <p className="mt-1 text-sm text-gray-500">
                    {t("profileDescription")}
                  </p>
                </div>
              </CardContent>
            </Card>
          </Link>
        </div>
      </div>
    </AccountShell>
  );
}
