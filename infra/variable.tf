variable "aws_project" {
  description = "The AWS project name."
  type        = string
  default     = "coding-workshop"
}

variable "aws_bucket" {
  description = "The AWS S3 bucket name for terraform state storage."
  type        = string
  default     = "coding-workshop-us-east-1-abcd1234"
}

variable "aws_app_code" {
  description = "The AWS application unique code."
  type        = string
  default     = "abcd1234"
}

variable "aws_ds_ip" {
  description = "The AWS Directory Service ip address."
  type        = string
  default     = ""
}

variable "aws_vpc_id" {
  description = "The AWS VPC identifier."
  type        = string
  default     = null
}

variable "aws_postgres_enabled" {
  description = "Enable or disable PostgreSQL (AWS Aurora). Default: true (set to 'false' to disable it)."
  type        = bool
  default     = true

  validation {
    condition     = contains([true, false], var.aws_postgres_enabled)
    error_message = "The aws_postgres_enabled variable must be either 'true' or 'false'."
  }
}

variable "aws_postgres_host" {
  description = "PostgreSQL host for LocalStack. Default: 'host.docker.internal' (set to '172.17.0.1' on Linux)."
  type        = string
  default     = null
}

variable "aws_mongo_enabled" {
  description = "Enable or disable MongoDB (AWS DocumentDB). Default: false (set to 'true' to enable it)."
  type        = bool
  default     = false

  validation {
    condition     = contains([true, false], var.aws_mongo_enabled)
    error_message = "The aws_mongo_enabled variable must be either 'true' or 'false'."
  }
}

variable "aws_mongo_host" {
  description = "MongoDB host for LocalStack. Default: 'host.docker.internal' (set to '172.17.0.1' on Linux)."
  type        = string
  default     = null
}

variable "aws_eks_enabled" {
  description = "Enable or disable Jupyter Notebook (AWS EKS). Default: false (set to 'true' to enable it)."
  type        = bool
  default     = false

  validation {
    condition     = contains([true, false], var.aws_eks_enabled)
    error_message = "The aws_eks_enabled variable must be either 'true' or 'false'."
  }
}

variable "aws_eks_type" {
  description = "EKS nodes type. Default: SPOT."
  type        = string
  default     = "SPOT"

  validation {
    condition     = contains(["ON_DEMAND", "SPOT"], var.aws_eks_type)
    error_message = "The aws_eks_type variable must be either 'ON_DEMAND' or 'SPOT'."
  }
}

# first facility admin (AD-21), seeded by the _migrate lambda only while no admin exists.
# a bcrypt hash, never the password: terraform state stores variable values in plain text.
variable "bootstrap_admin_email" {
  description = "Email of the first Facility Admin (must be @acme.inc). Empty skips seeding."
  type        = string
  default     = ""
}

variable "bootstrap_admin_name" {
  description = "Display name of the first Facility Admin."
  type        = string
  default     = "Facility Admin"
}

variable "bootstrap_admin_password_hash" {
  description = "bcrypt hash of the first Facility Admin's password. Empty skips seeding."
  type        = string
  default     = ""
  sensitive   = true
}
