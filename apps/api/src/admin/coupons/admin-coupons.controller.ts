import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  adminCouponCreateRequestSchema,
  adminCouponQuerySchema,
  adminCouponUpdateRequestSchema,
  type AdminCoupon,
  type AdminCouponList,
} from "@sakura/contracts";
import type { Request } from "express";
import { createZodDto } from "nestjs-zod";
import { CurrentAdmin, Roles } from "../auth/admin-auth.decorators";
import type { AccessClaims } from "../auth/tokens";
import type { AdminContext } from "../orders";
import { AdminCouponsService } from "./admin-coupons.service";

class AdminCouponQueryDto extends createZodDto(adminCouponQuerySchema) {}
class AdminCouponCreateDto extends createZodDto(adminCouponCreateRequestSchema) {}
class AdminCouponUpdateDto extends createZodDto(adminCouponUpdateRequestSchema) {}

/**
 * Issuing and managing discount codes.
 *
 * `@Roles("ADMIN")` on the whole controller, reads included: a coupon changes
 * what a customer pays, which is the line ADMIN_ROLES draws, and the list
 * itself — every live code and how much life each has left — is exactly what
 * /coupons/validate is careful never to reveal.
 */
@ApiTags("admin-coupons")
@Controller("admin/coupons")
@Roles("ADMIN")
export class AdminCouponsController {
  constructor(private readonly adminCouponsService: AdminCouponsService) {}

  @Get()
  @ApiOperation({ summary: "List every coupon with its current state and usage." })
  async list(@Query() query: AdminCouponQueryDto): Promise<AdminCouponList> {
    return this.adminCouponsService.list(query);
  }

  @Post()
  @ApiOperation({ summary: "Issue a new coupon code." })
  async create(
    @Body() body: AdminCouponCreateDto,
    @CurrentAdmin() admin: AccessClaims,
    @Req() request: Request,
  ): Promise<AdminCoupon> {
    return this.adminCouponsService.create(body, contextOf(admin, request));
  }

  @Patch(":id")
  @ApiOperation({ summary: "Change a coupon's terms, or switch it on or off." })
  async update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: AdminCouponUpdateDto,
    @CurrentAdmin() admin: AccessClaims,
    @Req() request: Request,
  ): Promise<AdminCoupon> {
    return this.adminCouponsService.update(id, body, contextOf(admin, request));
  }

  @Delete(":id")
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: "Delete a coupon that has never been used." })
  async remove(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AccessClaims,
    @Req() request: Request,
  ): Promise<void> {
    return this.adminCouponsService.remove(id, contextOf(admin, request));
  }
}

function contextOf(actor: AccessClaims, request: Request): AdminContext {
  return {
    actor,
    ipAddress: request.ip,
    userAgent: request.headers["user-agent"],
  };
}
