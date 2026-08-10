"use client";

import { useState } from "react";

import {
  BookCard,
  BookCover,
  BookGrid,
  BookGridSkeleton,
  CartItem,
  CartItemList,
  CatalogToolbar,
  CuratedShelf,
  EmptyState,
  FilterChips,
  OrderLine,
  OrderStatusTimeline,
  SummaryCard,
  SummaryRow,
  type OrderStep,
} from "@/components/domain";
import { Breadcrumbs, PageHeader, RailLayout, Section, Shell } from "@/components/layout";
import {
  Badge,
  Button,
  Card,
  CardDivider,
  CardTitle,
  Checkbox,
  CountBadge,
  Chip,
  Divider,
  Eyebrow,
  IconButton,
  Input,
  LoadingLine,
  Modal,
  Notice,
  OptionList,
  OrderId,
  Radio,
  RadioGroup,
  Select,
  Skeleton,
  Spinner,
  StatusPill,
  Stepper,
  Textarea,
  Toast,
  Wordmark,
} from "@/components/ui";
import { recentlyAdded, staffPicks } from "@/lib/books";

/* ==========================================================================
   Internal component playground — /playground

   Not a product page. Every component in one place so variants and states can
   be eyeballed together after a token change. Delete or gate this route before
   anything ships.
   ========================================================================== */

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[12rem_minmax(0,1fr)] lg:gap-14">
      <Eyebrow className="lg:pt-1">{label}</Eyebrow>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export default function Playground() {
  const [quantity, setQuantity] = useState(2);
  const [facet, setFacet] = useState("all");
  const [sort, setSort] = useState("new");
  const [status, setStatus] = useState<OrderStep>("shipped");
  const [modalOpen, setModalOpen] = useState(false);
  const [removing, setRemoving] = useState(false);

  const [first, second, third] = recentlyAdded;

  return (
    <Shell className="gap-section flex flex-col py-20">
      <PageHeader
        eyebrow="Internal"
        title="Component playground"
        description="Every primitive, domain component and shell in one place. Nothing here is a product page."
        size="lg"
      />

      {/* ---------------------------------------------------------------- */}
      <Section eyebrow="01" title="Primitives" className="flex flex-col gap-14">
        <Row label="Button">
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-3.5">
              <Button>Add to cart</Button>
              <Button variant="secondary">Add to list</Button>
              <Button variant="ghost">Continue browsing</Button>
              <Button variant="destructive">Remove</Button>
            </div>
            <div className="flex flex-wrap items-center gap-3.5">
              <Button disabled>Add to cart</Button>
              <Button variant="secondary" disabled>
                Out of stock
              </Button>
              <Button loading loadingLabel="Adding">
                Add to cart
              </Button>
            </div>
            <div className="flex flex-wrap items-center gap-3.5">
              <Button size="sm">Small</Button>
              <Button size="md">Medium</Button>
              <Button size="lg">Large</Button>
              <IconButton label="Quick view">
                <svg
                  viewBox="0 0 20 20"
                  className="size-5"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M6 14 14 6M7.5 6H14v6.5" />
                </svg>
              </IconButton>
            </div>
          </div>
        </Row>

        <Row label="Input · Select">
          <div className="grid gap-8 sm:grid-cols-2 lg:grid-cols-3">
            <Input label="Default" placeholder="Order ID, e.g. MG-40718" />
            <Input label="Filled" state="filled" defaultValue="MG-40718" />
            <Input
              label="Error"
              defaultValue="MG-407"
              error="Order IDs are eight characters, like MG-40718."
            />
            <Input label="Disabled" disabled defaultValue="Locked after payment" />
            <Select
              label="Select"
              value={sort}
              onChange={(event) => setSort(event.target.value)}
              options={[
                { value: "new", label: "Sort: Recently added" },
                { value: "title", label: "Sort: Title A–Z" },
                { value: "price", label: "Sort: Price, low to high" },
              ]}
            />
            <div>
              <Eyebrow className="mb-2.5">Open menu</Eyebrow>
              <OptionList
                label="Sort"
                value={sort}
                onSelect={setSort}
                options={[
                  { value: "new", label: "Recently added" },
                  { value: "title", label: "Title A–Z" },
                  { value: "price", label: "Price, low to high" },
                ]}
              />
            </div>
            <Textarea
              label="Textarea"
              placeholder="Anything we should know?"
              hint="Optional."
              fieldClassName="sm:col-span-2"
            />
          </div>
        </Row>

        <Row label="Choice · Status">
          <div className="grid gap-14 sm:grid-cols-2">
            <div className="flex flex-col gap-4">
              <Checkbox defaultChecked={false}>Billing address same as delivery</Checkbox>
              <Checkbox defaultChecked>Email me shipping updates</Checkbox>
              <Checkbox disabled>Gift wrap (unavailable)</Checkbox>
              <RadioGroup name="playground-delivery" label="Delivery">
                <Radio name="playground-delivery" defaultChecked>
                  Standard delivery · £3.50
                </Radio>
                <Radio name="playground-delivery">Next day · £6.00</Radio>
                <Radio name="playground-delivery" disabled>
                  Courier (unavailable)
                </Radio>
              </RadioGroup>
            </div>

            <div className="flex flex-col gap-4">
              <div className="flex flex-wrap gap-2.5">
                <StatusPill status="pending" />
                <StatusPill status="paid" />
                <StatusPill status="shipped" />
                <StatusPill status="delivered" />
                <StatusPill status="cancelled" />
              </div>
              <div className="flex flex-wrap gap-2.5">
                <Badge tone="accent">Editor&rsquo;s pick</Badge>
                <Badge>Last copy</Badge>
                <Badge>Signed</Badge>
              </div>
              <div className="flex flex-wrap items-center gap-2.5">
                <FilterChips
                  label="Category"
                  value={facet}
                  onChange={setFacet}
                  facets={[
                    { value: "all", label: "All" },
                    { value: "fiction", label: "Fiction" },
                    { value: "essays", label: "Essays" },
                    { value: "nature", label: "Nature" },
                    { value: "poetry", label: "Poetry" },
                  ]}
                />
                <Chip as="span">Read-only tag</Chip>
                <CountBadge count={3} />
                <CountBadge count={140} />
              </div>
              <Stepper
                value={quantity}
                onChange={setQuantity}
                engaged={quantity !== 2}
                label="Quantity, playground"
              />
            </div>
          </div>
        </Row>

        <Row label="Card · Modal · Notice">
          <div className="grid gap-10 lg:grid-cols-3">
            <div className="flex flex-col gap-5">
              <Card>
                <CardTitle>Order MG-40718</CardTitle>
                <p className="text-13 text-secondary mt-2.5">Placed 3 August 2026</p>
                <CardDivider />
                <div className="text-13.5 flex justify-between">
                  <span className="text-secondary">Total</span>
                  <span className="text-ink">£38.50</span>
                </div>
              </Card>
              <Card variant="tint">
                <Eyebrow>Tinted variant</Eyebrow>
                <p className="text-13.5 text-body mt-3 leading-relaxed">
                  Used for sections and summaries, never stacked inside another tinted block.
                </p>
              </Card>
            </div>

            <div className="flex flex-col gap-5">
              <Button variant="secondary" onClick={() => setModalOpen(true)}>
                Open modal
              </Button>
              <Modal
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                title="Remove this book?"
                description="The Hearing Trumpet will be taken out of your cart."
                actions={
                  <>
                    <Button size="sm" onClick={() => setModalOpen(false)}>
                      Remove
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setModalOpen(false)}>
                      Keep it
                    </Button>
                  </>
                }
              />
              <Divider />
              <div className="flex flex-wrap items-center gap-5">
                <Spinner />
                <LoadingLine>Checking status…</LoadingLine>
              </div>
              <div className="flex flex-col gap-3">
                <Skeleton className="h-3.5" />
                <Skeleton index={1} className="h-3.5 w-3/5" />
              </div>
            </div>

            <div className="flex flex-col gap-4">
              <Toast meta="Cart 3">Added to cart</Toast>
              <Notice>
                Card payments are handled by our gateway. We never store card details.
              </Notice>
              <Notice tone="error" lead="Payment declined.">
                Check the card number and try again.
              </Notice>
              <div className="flex items-center gap-4">
                <OrderId>MG-40718</OrderId>
                <Wordmark />
              </div>
            </div>
          </div>
        </Row>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section eyebrow="02" title="Domain" className="flex flex-col gap-14">
        <Row label="BookCover">
          <div className="flex flex-wrap items-end gap-8">
            <BookCover
              title="Pond"
              author="Claire-Louise Bennett"
              fallback="wordmark"
              className="w-40"
            />
            <BookCover title="Wintering" className="w-40" />
            <BookCover title="Autumn" radius="md" className="w-thumb-lg" />
            <BookCover title="Autumn" radius="xs" className="w-thumb-xs" />
          </div>
        </Row>

        <Row label="BookCard">
          <BookGrid>
            <BookCard book={first} />
            <BookCard book={second} />
            <BookCard book={{ ...third, soldOut: true }} />
            <div className="flex flex-col gap-6">
              <BookCard book={staffPicks[0]} layout="row" />
              <BookCard book={staffPicks[1]} layout="row" />
            </div>
          </BookGrid>
        </Row>

        <Row label="CuratedShelf">
          <Card variant="tint" padding="section">
            <CuratedShelf>
              <BookCard book={first} size="feature" inlineMeta showFlag={false} />
              <BookCard book={second} showFlag={false} inlineMeta />
              <BookCard book={third} showFlag={false} inlineMeta />
            </CuratedShelf>
          </Card>
        </Row>

        <Row label="Loading grid">
          <BookGridSkeleton count={4} />
        </Row>

        <Row label="Cart">
          <RailLayout
            rail={
              <SummaryCard
                title="Summary"
                footer={
                  <>
                    <Button block className="mt-6">
                      Checkout
                    </Button>
                    <p className="text-caption text-secondary mt-4 leading-relaxed">
                      Payment is taken by our gateway. Card details never touch our servers.
                    </p>
                  </>
                }
              >
                <SummaryRow label="Subtotal · 4 books" value="£49.00" />
                <SummaryRow label="Delivery" value="£3.50" />
                <SummaryRow tone="credit" label="Free over £30" value="−£3.50" />
                <SummaryRow tone="total" label="Total" value="£49.00" />
              </SummaryCard>
            }
          >
            <CartItemList>
              <CartItem book={{ ...first, format: "Paperback" }} quantity={1} lineTotal="£14.00" />
              <CartItem
                book={{ ...second, format: "Paperback" }}
                quantity={quantity}
                onQuantityChange={setQuantity}
                engaged
                lineTotal="£25.00"
                onRemove={() => setRemoving(true)}
              />
              <CartItem
                book={third}
                quantity={1}
                lineTotal="£10.00"
                removing={removing}
                onUndoRemove={() => setRemoving(false)}
              />
            </CartItemList>
          </RailLayout>
        </Row>

        <Row label="OrderLine">
          <div className="grid gap-10 sm:grid-cols-2">
            <div className="flex flex-col gap-4">
              <OrderLine book={first} quantity={1} amount="£14.00" />
              <OrderLine book={second} quantity={2} amount="£25.00" />
            </div>
            <div className="hairline">
              <OrderLine book={first} quantity={1} amount="£14.00" size="md" />
              <OrderLine book={second} quantity={2} amount="£25.00" size="md" />
            </div>
          </div>
        </Row>

        <Row label="OrderStatusTimeline">
          <div className="flex flex-col gap-10">
            <CatalogToolbar>
              {(["pending", "paid", "shipped", "delivered"] as const).map((step) => (
                <Chip key={step} active={status === step} onClick={() => setStatus(step)}>
                  {step}
                </Chip>
              ))}
            </CatalogToolbar>

            <OrderStatusTimeline
              status={status}
              detail={{
                pending: "3 Aug, 14:02",
                paid: "3 Aug, 14:04",
                shipped: "5 Aug · Royal Mail 48",
                delivered: "Expected 8 Aug",
              }}
            />

            <Card variant="tint" padding="section">
              <OrderStatusTimeline status={status} size="compact" />
            </Card>
          </div>
        </Row>

        <Row label="EmptyState">
          <div className="grid gap-8 lg:grid-cols-3">
            <EmptyState
              eyebrow="Cart"
              title="Your cart is empty"
              description="Forty-one titles are waiting on the shelf."
              action={<Button size="sm">Browse books</Button>}
            />
            <EmptyState
              eyebrow="Search"
              title="Nothing for “carrington”"
              description="Try an author, a title, or ask us to find it."
              action={
                <Button size="sm" variant="secondary">
                  Clear search
                </Button>
              }
            />
            <EmptyState
              eyebrow="Order lookup"
              title="No order found"
              description="Check the ID in your confirmation email, or write to us."
              action={
                <Button size="sm" variant="secondary">
                  Email support
                </Button>
              }
            />
          </div>
        </Row>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section eyebrow="03" title="Shells" className="flex flex-col gap-14">
        <Row label="Breadcrumbs">
          <Breadcrumbs
            items={[
              { href: "/catalog", label: "Books" },
              { href: "/catalog?facet=fiction", label: "Fiction" },
              { label: "The Hearing Trumpet" },
            ]}
          />
        </Row>

        <Row label="PageHeader">
          <PageHeader
            eyebrow="41 titles"
            title="All books"
            size="lg"
            actions={
              <CatalogToolbar>
                <Input placeholder="Search title or author" className="sm:w-64" />
                <Select aria-label="Sort" options={[{ value: "new", label: "Recently added" }]} />
              </CatalogToolbar>
            }
          />
        </Row>

        <Row label="Section · tint">
          <Section tint title="This month's shelf" action={<a href="#playground">All 41 →</a>}>
            <BookGrid>
              <BookCard book={first} showFlag={false} />
              <BookCard book={second} showFlag={false} />
            </BookGrid>
          </Section>
        </Row>
      </Section>
    </Shell>
  );
}
