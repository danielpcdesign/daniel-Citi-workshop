# schema migrations (AD-03): a private lambda with no function url, run by terraform during apply.
# declared here rather than discovered, because backend/_migrate is excluded from service discovery.

locals {
  migrate_path = abspath(format("%s/../backend/_migrate", path.module))
  migrations_hash = sha256(join("", [
    for f in sort(fileset(local.migrate_path, "migrations/*.sql")) :
    filesha256(format("%s/%s", local.migrate_path, f))
  ]))
}

module "migrate" {
  source  = "terraform-aws-modules/lambda/aws"
  version = "~> 8.0"

  function_name   = format("%s-migrate-%s", var.aws_project, local.app_id)
  package_type    = "Zip"
  architectures   = ["x86_64"]
  handler         = "function.handler"
  runtime         = "python3.13"
  memory_size     = 128
  timeout         = 300
  tracing_mode    = "PassThrough"
  build_in_docker = false
  lambda_role     = local.lambda_role_arn
  store_on_s3     = data.aws_caller_identity.this.id != "000000000000"
  s3_bucket       = data.aws_caller_identity.this.id != "000000000000" ? format("%s-tfstate-%s", var.aws_project, local.app_id) : null
  s3_prefix       = data.aws_caller_identity.this.id != "000000000000" ? format("lambda/%s/migrate/", local.app_id) : null

  source_path = [{
    path             = local.migrate_path
    patterns         = ["!__pycache__/.*", "!\\..*"]
    pip_requirements = true
  }]

  # inside the vpc: cloud aurora is not publicly accessible
  vpc_security_group_ids = data.aws_security_groups.this.ids
  vpc_subnet_ids         = local.public_subnet_ids
  attach_network_policy  = true

  create_package                    = true
  create_role                       = false
  attach_cloudwatch_logs_policy     = true
  cloudwatch_logs_retention_in_days = 7
  cloudwatch_logs_skip_destroy      = false
  use_existing_cloudwatch_log_group = false
  trigger_on_package_timestamp      = false

  # the point of this file: nothing on the internet can reach it
  create_lambda_function_url = false

  # invoked synchronously by terraform, so a dead-letter queue would never receive anything
  attach_dead_letter_policy = false

  environment_variables = {
    for key, value in local.env_vars :
    key => trimspace(value) if try(trimspace(value), "") != ""
  }

  tags = local.app_tags
}

resource "aws_lambda_invocation" "migrate" {
  function_name = module.migrate.lambda_function_name
  # seeding values travel in the invocation input, not the function's env vars, so they are not
  # left visible in the lambda configuration
  input = jsonencode({
    action = "migrate"
    bootstrap_admin = {
      email         = var.bootstrap_admin_email
      full_name     = var.bootstrap_admin_name
      password_hash = var.bootstrap_admin_password_hash
    }
  })

  # re-run whenever a migration file or the runner changes
  triggers = {
    migrations = local.migrations_hash
    code       = module.migrate.lambda_function_source_code_hash
  }
}
