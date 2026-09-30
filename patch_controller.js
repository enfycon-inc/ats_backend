const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'src/auth/auth.controller.ts');
let content = fs.readFileSync(filePath, 'utf8');

content = content.replace(
  "import { JwtAuthGuard } from './guards/jwt-auth.guard';",
  "import { JwtAuthGuard } from './guards/jwt-auth.guard';\nimport { OptionalJwtAuthGuard } from './guards/optional-jwt-auth.guard';\nimport { AuthUser } from './decorators/current-user.decorator';"
);

// We need to make sure we don't duplicate imports if they already exist
if (content.split("import { AuthUser").length > 2) {
  content = content.replace("import { AuthUser } from './decorators/current-user.decorator';\n", "");
}

const registerRegex = /@Post\('register'\)[\s\S]*?async register\(\s*@Body\(\) dto: RegisterDto,\s*@Headers\('authorization'\) authHeader\?: string,\s*\) \{\s*return this\.authService\.register\(dto, authHeader\);\s*\}/;

const replacement = `@Post('register')
  @HttpCode(HttpStatus.CREATED)
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary: 'Register new user account',
    description: 'Creates a new user. Admins can create approved users.',
  })
  @ApiResponse({ status: 201, description: 'User registered successfully.' })
  @ApiResponse({ status: 409, description: 'Email already registered.' })
  @ApiResponse({ status: 400, description: 'Invalid role or missing fields.' })
  async register(
    @Body() dto: RegisterDto,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.authService.register(dto, user);
  }`;

content = content.replace(registerRegex, replacement);
fs.writeFileSync(filePath, content, 'utf8');
console.log('Successfully patched auth.controller.ts');
