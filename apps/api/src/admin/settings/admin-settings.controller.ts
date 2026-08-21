import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Req } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  adminRegionCreateSchema,
  adminRegionUpdateSchema,
  shippingTermsUpdateSchema,
  type AdminRegion,
  type AdminShippingTerms,
  type UnitsSoldReport,
} from "@sakura/contracts";
import type { Request } from "express";
import { createZodDto } from "nestjs-zod";
import { CurrentAdmin, Roles } from "../auth/admin-auth.decorators";
import type { AccessClaims } from "../auth/tokens";
import type { AdminContext } from "../orders";
import { AdminSettingsService } from "./admin-settings.service";

class ShippingTermsUpdateDto extends createZodDto(shippingTermsUpdateSchema) {}
class AdminRegionCreateDto extends createZodDto(adminRegionCreateSchema) {}
class AdminRegionUpdateDto extends createZodDto(adminRegionUpdateSchema) {}

/**
 * Shop policy and maintenance.
 *
 * Reads are open to any signed-in admin; **every write here is ADMIN-only**.
 * That is the line ADMIN_ROLES draws — "can this person change what a customer
 * pays" — and it applies more literally here than anywhere else in the panel:
 * the postage rate and the free-delivery threshold are multiplied into every
 * cart in the shop, so a mistake is not one wrong order, it is every order
 * until someone notices.
 */
@ApiTags("admin-settings")
@Controller("admin/settings")
export class AdminSettingsController {
  constructor(private readonly settingsService: AdminSettingsService) {}

  @Get("shipping")
  @ApiOperation({ summary: "Postage rules, and whether they come from the DB or the environment." })
  async shippingTerms(): Promise<AdminShippingTerms> {
    return this.settingsService.shippingTerms();
  }

  /**
   * Change the postage rules.
   *
   * PATCH, and the partial semantics are load-bearing rather than idiomatic
   * tidiness: sending only the field being changed is what lets the flat rate
   * stay on the environment while the threshold moves to the database. A PUT
   * carrying both would silently promote whichever field the form happened to
   * have loaded, and the deployment's environment variable would go inert
   * without anybody choosing that.
   */
  @Patch("shipping")
  @Roles("ADMIN")
  @ApiOperation({ summary: "Change postage rates. Takes effect on the next quote." })
  async updateShippingTerms(
    @Body() body: ShippingTermsUpdateDto,
    @CurrentAdmin() admin: AccessClaims,
    @Req() request: Request,
  ): Promise<AdminShippingTerms> {
    return this.settingsService.updateShippingTerms(body, contextOf(admin, request));
  }

  @Get("regions")
  @ApiOperation({ summary: "Every delivery region, including deactivated ones." })
  async regions(): Promise<AdminRegion[]> {
    return this.settingsService.regions();
  }

  @Post("regions")
  @Roles("ADMIN")
  @ApiOperation({ summary: "Add a delivery region." })
  async createRegion(
    @Body() body: AdminRegionCreateDto,
    @CurrentAdmin() admin: AccessClaims,
    @Req() request: Request,
  ): Promise<AdminRegion> {
    return this.settingsService.createRegion(body, contextOf(admin, request));
  }

  /**
   * Edit a region. The slug is the address, not a field — see the contract for
   * why it cannot move once orders have snapshotted it.
   */
  @Patch("regions/:slug")
  @Roles("ADMIN")
  @ApiOperation({ summary: "Change a region's name, rate, order, or active flag." })
  async updateRegion(
    @Param("slug") slug: string,
    @Body() body: AdminRegionUpdateDto,
    @CurrentAdmin() admin: AccessClaims,
    @Req() request: Request,
  ): Promise<AdminRegion> {
    return this.settingsService.updateRegion(slug, body, contextOf(admin, request));
  }

  /**
   * Stop offering a region.
   *
   * DELETE, because that is what the operator is doing — but it deactivates,
   * and the response is the deactivated row rather than 204 so the panel can
   * show it greyed out and offer to switch it back on. A hard delete would
   * orphan every historical order naming the slug.
   */
  @Delete("regions/:slug")
  @Roles("ADMIN")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Deactivate a region. Historical orders keep naming it." })
  async deactivateRegion(
    @Param("slug") slug: string,
    @CurrentAdmin() admin: AccessClaims,
    @Req() request: Request,
  ): Promise<AdminRegion> {
    return this.settingsService.deactivateRegion(slug, contextOf(admin, request));
  }

  /**
   * Inspect the `units_sold` cache. A GET, because it writes nothing — the
   * separation from the POST below is the whole point: seeing the drift is
   * usually the answer, and an inspection that could only be had by writing is
   * one nobody would run.
   */
  @Get("maintenance/units-sold")
  @ApiOperation({ summary: "Report titles whose units_sold disagrees with order history." })
  async unitsSoldDrift(): Promise<UnitsSoldReport> {
    return this.settingsService.unitsSoldDrift();
  }

  @Post("maintenance/units-sold")
  @Roles("ADMIN")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Recompute units_sold from order history." })
  async reconcileUnitsSold(
    @CurrentAdmin() admin: AccessClaims,
    @Req() request: Request,
  ): Promise<UnitsSoldReport> {
    return this.settingsService.reconcileUnitsSold(contextOf(admin, request));
  }
}

function contextOf(actor: AccessClaims, request: Request): AdminContext {
  return { actor, ipAddress: request.ip, userAgent: request.headers["user-agent"] };
}
