import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import {
  adminCreateStaffRequestSchema,
  adminUpdateStaffRequestSchema,
  type AdminStaffCredentialResult,
  type AdminStaffList,
  type AdminStaffMember,
} from "@sakura/contracts";
import type { Request } from "express";
import { createZodDto } from "nestjs-zod";
import { CurrentAdmin, Roles } from "../auth/admin-auth.decorators";
import type { AccessClaims } from "../auth/tokens";
import { AdminUsersService, type AdminUsersContext } from "./admin-users.service";

class AdminCreateStaffDto extends createZodDto(adminCreateStaffRequestSchema) {}
class AdminUpdateStaffDto extends createZodDto(adminUpdateStaffRequestSchema) {}

/**
 * Settings → User Management, over HTTP.
 *
 * `@Roles("ADMIN")` on the whole controller, the list included. Deciding who
 * can sign in, and as what, is the one thing in the panel that changes what
 * everyone else can do — and the list itself names every account a password
 * could be tried against. STAFF and FULFILLMENT get neither.
 *
 * Disable and enable are their own POSTs rather than a `disabled` field on the
 * PATCH, so that the audit log's "who switched this account off" is one
 * route's worth of entries and never a side effect of editing a name.
 */
@ApiTags("admin-users")
@Controller("admin/users")
@Roles("ADMIN")
export class AdminUsersController {
  constructor(private readonly adminUsersService: AdminUsersService) {}

  @Get()
  @ApiOperation({ summary: "Every staff account, active first." })
  async list(@CurrentAdmin() admin: AccessClaims): Promise<AdminStaffList> {
    return this.adminUsersService.list(admin);
  }

  @Post()
  @ApiOperation({ summary: "Add an account. Returns its temporary password, once." })
  async create(
    @Body() body: AdminCreateStaffDto,
    @CurrentAdmin() admin: AccessClaims,
    @Req() request: Request,
  ): Promise<AdminStaffCredentialResult> {
    return this.adminUsersService.create(body, contextOf(admin, request));
  }

  @Patch(":id")
  @ApiOperation({ summary: "Rename an account or change its role." })
  async update(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() body: AdminUpdateStaffDto,
    @CurrentAdmin() admin: AccessClaims,
    @Req() request: Request,
  ): Promise<AdminStaffMember> {
    return this.adminUsersService.update(id, body, contextOf(admin, request));
  }

  @Post(":id/disable")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Switch an account off and sign it out everywhere." })
  async disable(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AccessClaims,
    @Req() request: Request,
  ): Promise<AdminStaffMember> {
    return this.adminUsersService.disable(id, contextOf(admin, request));
  }

  @Post(":id/enable")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Switch an account back on." })
  async enable(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AccessClaims,
    @Req() request: Request,
  ): Promise<AdminStaffMember> {
    return this.adminUsersService.enable(id, contextOf(admin, request));
  }

  @Post(":id/reset-password")
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: "Replace the password with a new one, returned once." })
  async resetPassword(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentAdmin() admin: AccessClaims,
    @Req() request: Request,
  ): Promise<AdminStaffCredentialResult> {
    return this.adminUsersService.resetPassword(id, contextOf(admin, request));
  }
}

function contextOf(actor: AccessClaims, request: Request): AdminUsersContext {
  return { actor, ipAddress: request.ip, userAgent: request.headers["user-agent"] };
}
